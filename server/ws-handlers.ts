import type { IncomingMessage } from 'http'
import type { WebSocket } from 'ws'
import { verifyTranscriptionToken } from './client-connection.js'
import {
  registerClientForSession,
  unregisterClient,
} from './client-connection.js'
import {
  incrementConnections,
  decrementConnections,
  recordError,
} from './metrics.js'
import { cleanupClientTracker } from './audio-validator.js'
import { updateActiveSpeaker, type ActiveSpeakerEvent } from './active-speaker-tracker.js'

export interface ClientInfo {
  sessionSlug?: string
  userId?: string
  identity?: string
  sessionId?: string
  [key: string]: any
}

/**
 * Инициализирует WebSocket соединение с клиентом.
 * Вызывается после успешного upgrade.
 */
export function initWebSocketConnection(
  ws: WebSocket,
  request: IncomingMessage,
  clientInfo?: ClientInfo
): void {
  const sessionSlug = clientInfo?.sessionSlug
  const userId = clientInfo?.userId
  const identity = clientInfo?.identity
  const participantIdentity = identity

  console.log('[WS] New client connected', {
    sessionSlug,
    userId,
    identity,
    remoteAddress: request.socket.remoteAddress,
    host: request.headers.host,
    origin: request.headers.origin,
    readyState: ws.readyState,
  })

  // Регистрируем клиента для получения транскриптов от серверной транскрипции
  if (sessionSlug) {
    registerClientForSession(sessionSlug, ws)
  }

  // Отправляем initial message (строгий JSON)
  // НЕ отправляем сразу - ждем, когда соединение полностью готово
  const sendInitialMessage = () => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const message = JSON.stringify({
          type: 'connected',
          sessionSlug,
          userId,
          message: 'WebSocket connection established',
          ts: Date.now(),
        })
        ws.send(message)
        console.log('[WS] ✅ Initial message sent to client', {
          messageLength: message.length,
          readyState: ws.readyState,
          sessionSlug,
        })
      } catch (error) {
        console.error('[WS] ❌ Failed to send initial message:', error)
      }
    } else {
      console.warn(`[WS] ⚠️ WebSocket not OPEN when trying to send initial message (state: ${ws.readyState})`)
    }
  }

  // Пытаемся отправить сразу, если соединение уже открыто
  if (ws.readyState === WebSocket.OPEN) {
    sendInitialMessage()
  } else {
    // Если еще не открыто, ждем события 'open'
    ws.once('open', () => {
      sendInitialMessage()
    })
  }

  // Обработчики сообщений от клиента
  ws.on('message', (data: WebSocket.Data) => {
    // Обрабатываем только JSON сообщения (active speaker events)
    // Аудио чанки больше не обрабатываем - серверная транскрипция работает через RTMP
    if (typeof data === 'string' || (data instanceof Buffer && data[0] === 0x7B)) {
      try {
        const message = JSON.parse(data.toString())

        // Обрабатываем active speaker events
        if (message.type === 'active_speaker') {
          const speakerEvent: ActiveSpeakerEvent = {
            sessionSlug: sessionSlug || '',
            participantIdentity: message.identity || participantIdentity || '',
            participantName: message.name,
            timestamp: message.timestamp || Date.now(),
          }
          updateActiveSpeaker(speakerEvent)
          return
        }
      } catch (error) {
        // Не JSON или невалидный JSON - игнорируем
        console.warn('[WS] Received non-JSON message, ignoring', { sessionSlug })
      }
    }

    // Игнорируем аудио чанки - серверная транскрипция работает через RTMP
    // Клиенты больше не отправляют аудио через WebSocket
  })

  // Настраиваем ping/pong для поддержания соединения живым
  // Стандартный интервал - 30 секунд
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping()
      } catch (error) {
        console.error('[WS] Failed to send ping:', error)
        clearInterval(pingInterval)
      }
    } else {
      clearInterval(pingInterval)
    }
  }, 30000) // Ping каждые 30 секунд

  // Увеличиваем счетчик активных соединений
  incrementConnections()

  // Обработчик закрытия соединения
  ws.on('close', (code, reason) => {
    clearInterval(pingInterval)

    console.log('[WS] Client disconnected', {
      sessionSlug,
      userId,
      identity: participantIdentity,
      code,
      reason: reason?.toString() || 'no reason',
      readyState: ws.readyState,
      // Коды закрытия WebSocket:
      // 1000 = Normal Closure
      // 1001 = Going Away
      // 1006 = Abnormal Closure (Railway proxy часто закрывает так)
      codeMeaning:
        code === 1000
          ? 'Normal Closure'
          : code === 1001
            ? 'Going Away'
            : code === 1006
              ? 'Abnormal Closure (no close frame received)'
              : 'Other',
    })

    // Отменяем регистрацию клиента
    if (sessionSlug) {
      unregisterClient(sessionSlug, ws)
    }

    // Очищаем трекер для клиента
    if (participantIdentity) {
      cleanupClientTracker(participantIdentity)
    }

    // Уменьшаем счетчик соединений
    decrementConnections()
  })

  // Обработчик ошибок
  ws.on('error', (error) => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[WS] WebSocket error', {
      error: errorMsg,
      readyState: ws.readyState,
      sessionSlug,
      userId,
      identity: participantIdentity,
      stack: error instanceof Error ? error.stack : undefined,
    })
    recordError(`Client WebSocket error: ${errorMsg}`)
    clearInterval(pingInterval)
    decrementConnections()
  })
}

/**
 * Валидирует токен и извлекает информацию о клиенте из query параметров.
 * Вызывается ДО upgrade, чтобы проверить авторизацию.
 */
export function validateTokenAndSession(
  token: string | undefined,
  sessionSlug: string | undefined
): { ok: true; sessionSlug: string; userId?: string; identity?: string; sessionId?: string } | { ok: false } {
  if (!token) {
    console.error('[WS] Missing transcription token')
    return { ok: false }
  }

  // Валидируем токен и получаем данные
  const tokenData = verifyTranscriptionToken(token)
  if (!tokenData) {
    console.error('[WS] Invalid or expired transcription token')
    return { ok: false }
  }

  // Проверяем, что sessionSlug из токена совпадает с переданным (если передан)
  if (sessionSlug && tokenData.sessionSlug !== sessionSlug) {
    console.error('[WS] Session slug mismatch', {
      tokenSlug: tokenData.sessionSlug,
      querySlug: sessionSlug,
    })
    return { ok: false }
  }

  return {
    ok: true,
    sessionSlug: tokenData.sessionSlug,
    userId: tokenData.userId,
    identity: tokenData.identity,
    sessionId: tokenData.sessionId,
  }
}


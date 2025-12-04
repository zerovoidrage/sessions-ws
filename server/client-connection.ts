import { WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
// Убрали импорты createGladiaBridge и appendTranscriptChunk - клиенты больше не создают Gladia сессии
// Серверная транскрипция создает ОДНУ Gladia сессию на комнату
import {
  incrementConnections,
  decrementConnections,
  incrementMessagesSent,
  recordError,
} from './metrics'
import { recordCounter, recordLatency } from './realtime-metrics.js'
import { cleanupClientTracker } from './audio-validator.js'
import { updateActiveSpeaker, type ActiveSpeakerEvent } from './active-speaker-tracker.js'

dotenv.config()

import type { WsClientMeta } from './types.js'

// Хранилище клиентов по сессиям для отправки транскриптов от серверной транскрипции
// Используем Map<sessionSlug, Set<WsClientMeta>> для хранения метаданных о клиентах
const sessionClients = new Map<string, Set<WsClientMeta>>()

// Очереди для backpressure: Map<sessionSlug, Array<ServerTranscriptionMessage>>
// Ограничиваем размер очереди для предотвращения переполнения памяти
const sessionQueues = new Map<string, Array<any>>()
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_BROADCAST_QUEUE_SIZE || '1000', 10)

// Дедупликация final транскриптов: Map<sessionSlug, Set<utteranceId>>
// Храним последние 1000 utteranceId для каждой сессии
const recentUtteranceIds = new Map<string, Set<string>>()
const MAX_UTTERANCE_IDS = 1000

/**
 * Регистрирует клиента для сессии с метаданными.
 */
export function registerClientForSession(
  sessionSlug: string,
  ws: WebSocket,
  meta?: { userId?: string }
): void {
  if (!sessionClients.has(sessionSlug)) {
    sessionClients.set(sessionSlug, new Set())
  }
  
  const clientMeta: WsClientMeta = {
    ws,
    sessionSlug,
    userId: meta?.userId,
    connectedAt: Date.now(),
  }
  
  const clients = sessionClients.get(sessionSlug)!
  clients.add(clientMeta)
  
  // Обновляем метрику количества клиентов per session
  recordCounter(`ws.session_clients.${sessionSlug}`, clients.size)
  
  console.log('[WS-SERVER] Client registered', {
    sessionSlug,
    userId: meta?.userId,
    activeClientsInSession: clients.size,
  })
}

/**
 * Отменяет регистрацию клиента для сессии.
 */
export function unregisterClient(sessionSlug: string, ws: WebSocket): void {
  const clients = sessionClients.get(sessionSlug)
  if (clients) {
    // Находим клиента по WebSocket и удаляем
    for (const clientMeta of clients) {
      if (clientMeta.ws === ws) {
        clients.delete(clientMeta)
        break
      }
    }
    
    if (clients.size === 0) {
      sessionClients.delete(sessionSlug)
      // Удаляем метрику для сессии без клиентов
      recordCounter(`ws.session_clients.${sessionSlug}`, 0)
      // Очищаем очередь и дедупликацию для сессии без клиентов
      sessionQueues.delete(sessionSlug)
      recentUtteranceIds.delete(sessionSlug)
      // Очищаем AI состояние для сессии (асинхронно, не блокируем)
      import('./ai-coordinator.js').then(({ cleanupAiState }) => {
        cleanupAiState(sessionSlug)
      }).catch((error) => {
        console.error('[WS-SERVER] Failed to cleanup AI state:', error)
      })
      console.log('[WS-SERVER] Session has no more clients, removed from registry', {
        sessionSlug,
      })
    } else {
      // Обновляем метрику количества клиентов per session
      recordCounter(`ws.session_clients.${sessionSlug}`, clients.size)
      console.log('[WS-SERVER] Client unregistered', {
        sessionSlug,
        remainingClientsInSession: clients.size,
      })
    }
  }
}

/**
 * Получает всех клиентов для сессии.
 */
export function getClientsForSession(sessionSlug: string): Set<WsClientMeta> | undefined {
  return sessionClients.get(sessionSlug)
}

/**
 * Обрабатывает очередь сообщений для сессии (асинхронно, не блокирует event loop).
 */
function processQueue(sessionSlug: string): void {
  const queue = sessionQueues.get(sessionSlug)
  if (!queue || queue.length === 0) {
    return
  }

  const clients = sessionClients.get(sessionSlug)
  if (!clients || clients.size === 0) {
    // Нет клиентов - очищаем очередь
    sessionQueues.delete(sessionSlug)
    return
  }

  // Берем первое сообщение из очереди
  const payload = queue.shift()!
  const message = JSON.stringify(payload)
  let sentCount = 0
  const deadClients: WsClientMeta[] = []
  const broadcastStart = Date.now()
  
  for (const clientMeta of clients) {
    if (clientMeta.ws.readyState === WebSocket.OPEN) {
      try {
        clientMeta.ws.send(message)
        sentCount++
      } catch (error) {
        console.error('[WS-SERVER] Failed to send transcript to client, removing dead client:', {
          sessionSlug,
          userId: clientMeta.userId,
          error: error instanceof Error ? error.message : String(error),
        })
        recordCounter('ws.broadcast_errors_total')
        deadClients.push(clientMeta)
      }
    } else {
      deadClients.push(clientMeta)
    }
  }
  
  // Удаляем мертвых клиентов
  for (const deadClient of deadClients) {
    unregisterClient(sessionSlug, deadClient.ws)
  }
  
  const broadcastEnd = Date.now()
  const broadcastLatency = broadcastEnd - broadcastStart
  
  if (sentCount > 0) {
    incrementMessagesSent()
    // Записываем метрику задержки broadcast
    recordLatency(`ws.session_broadcast_lag_ms.${sessionSlug}`, broadcastLatency)
  }
  
  // Если очередь не пуста - обрабатываем следующее сообщение асинхронно
  if (queue.length > 0) {
    setImmediate(() => processQueue(sessionSlug))
  } else {
    // Очередь пуста - удаляем её
    sessionQueues.delete(sessionSlug)
  }
}

/**
 * Отправляет транскрипт всем клиентам сессии с поддержкой backpressure и дедупликации.
 * Автоматически удаляет мертвых клиентов при ошибках отправки.
 * Использует асинхронные очереди для предотвращения блокировки event loop.
 * Дедуплицирует final транскрипты для предотвращения дубликатов при реконнектах.
 */
export function broadcastToSessionClients(sessionSlug: string, payload: any): void {
  const clients = sessionClients.get(sessionSlug)
  if (!clients || clients.size === 0) {
    console.log('[WS-SERVER] No clients to broadcast transcript', {
      sessionSlug,
      textPreview: payload.text ? payload.text.slice(0, 80) : 'no text',
    })
    return
  }

  // Дедупликация final транскриптов
  const isFinal = payload.isFinal === true || payload.type === 'transcript_final'
  const utteranceId = payload.utteranceId
  
  if (isFinal && utteranceId) {
    let utteranceIds = recentUtteranceIds.get(sessionSlug)
    if (!utteranceIds) {
      utteranceIds = new Set()
      recentUtteranceIds.set(sessionSlug, utteranceIds)
    }
    
    // Если final транскрипт уже был отправлен - пропускаем
    if (utteranceIds.has(utteranceId)) {
      console.log('[WS-SERVER] Duplicate final transcript, skipping', {
        sessionSlug,
        utteranceId,
        textPreview: payload.text ? payload.text.slice(0, 80) : 'no text',
      })
      recordCounter('ws.duplicate_final_transcripts_skipped')
      return
    }
    
    // Добавляем utteranceId в Set
    utteranceIds.add(utteranceId)
    
    // Ограничиваем размер Set (храним только последние MAX_UTTERANCE_IDS)
    if (utteranceIds.size > MAX_UTTERANCE_IDS) {
      // Удаляем самый старый (первый) элемент
      const firstId = utteranceIds.values().next().value
      if (firstId) {
        utteranceIds.delete(firstId)
      }
    }
  }

  // Получаем или создаем очередь для сессии
  let queue = sessionQueues.get(sessionSlug)
  if (!queue) {
    queue = []
    sessionQueues.set(sessionSlug, queue)
  }
  
  // Если очередь переполнена - дропаем самое старое сообщение
  if (queue.length >= MAX_QUEUE_SIZE) {
    const dropped = queue.shift()
    recordCounter('ws.queue_drops_total')
    console.warn('[WS-SERVER] Queue overflow, dropped message', {
      sessionSlug,
      droppedType: dropped?.type,
      queueSize: queue.length,
      maxQueueSize: MAX_QUEUE_SIZE,
    })
  }
  
  // Добавляем сообщение в очередь
  queue.push(payload)
  
  // Асинхронно обрабатываем очередь (не блокируем event loop)
  setImmediate(() => processQueue(sessionSlug))
}

/**
 * Отправляет сообщение об ошибке транскрипции всем клиентам сессии.
 * Автоматически удаляет мертвых клиентов при ошибках отправки.
 */
export function sendTranscriptionErrorToSessionClients(
  sessionSlug: string,
  reason: 'livekit_unauthorized' | 'internal_error',
  message?: string
): void {
  const clients = sessionClients.get(sessionSlug)
  if (!clients || clients.size === 0) {
    console.log('[WS-SERVER] No clients to send transcription error', {
      sessionSlug,
      reason,
    })
    return
  }

  const errorPayload = {
    type: 'transcription_error',
    reason,
    message: message || 'Failed to start transcription. Please contact support or check LiveKit API credentials.',
    sessionSlug,
    ts: Date.now(),
  }

  const errorMessage = JSON.stringify(errorPayload)
  let sentCount = 0
  const deadClients: WsClientMeta[] = []

  for (const clientMeta of clients) {
    if (clientMeta.ws.readyState === WebSocket.OPEN) {
      try {
        clientMeta.ws.send(errorMessage)
        sentCount++
      } catch (error) {
        console.error('[WS-SERVER] Failed to send transcription error to client, removing dead client:', {
          sessionSlug,
          userId: clientMeta.userId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Помечаем клиента для удаления
        deadClients.push(clientMeta)
      }
    } else {
      // Клиент не в состоянии OPEN - помечаем для удаления
      deadClients.push(clientMeta)
    }
  }

  // Удаляем мертвых клиентов
  for (const deadClient of deadClients) {
    unregisterClient(sessionSlug, deadClient.ws)
  }

  if (sentCount > 0) {
    console.log('[WS-SERVER] Sent transcription error to clients', {
      sessionSlug,
      reason,
      clientsInSession: clients.size,
      sent: sentCount,
      removed: deadClients.length,
    })
  }
}

export interface ClientConnectionOptions {
  ws: WebSocket
  req: IncomingMessage
}

interface TranscriptionTokenPayload {
  sub: string
  sessionId: string
  sessionSlug: string
  identity: string
  exp: number
  iat: number
}

/**
 * Валидирует JWT токен для транскрипции и возвращает данные из токена.
 * 
 * @param token - JWT токен из query параметра
 * @returns Данные из токена или null, если токен невалиден
 */
export function verifyTranscriptionToken(token: string): {
  sessionSlug: string
  identity: string
  userId?: string
  sessionId: string
} | null {
  try {
    const jwtSecret = process.env.TRANSCRIPTION_JWT_SECRET
    if (!jwtSecret) {
      console.error('[WS-SERVER] TRANSCRIPTION_JWT_SECRET is not set')
      return null
    }

    const decoded = jwt.verify(token, jwtSecret) as TranscriptionTokenPayload

    return {
      sessionSlug: decoded.sessionSlug,
      identity: decoded.identity,
      userId: decoded.sub,
      sessionId: decoded.sessionId,
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      console.error('[WS-SERVER] Invalid transcription token:', error.message)
    } else if (error instanceof jwt.TokenExpiredError) {
      console.error('[WS-SERVER] Transcription token expired:', error.expiredAt)
    } else {
      console.error('[WS-SERVER] Error verifying transcription token:', error)
    }
    return null
  }
}

export function handleClientConnection({ ws, req }: ClientConnectionOptions): void {
  console.log('[WS-SERVER] Client connected', {
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    origin: req.headers.origin,
    readyState: ws.readyState, // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
    protocol: ws.protocol,
    extensions: ws.extensions,
  })

  // Логируем состояние WebSocket сразу после подключения
  // Railway proxy может закрыть соединение до того, как мы успеем что-то сделать
  const checkInterval = setInterval(() => {
    console.log('[WS-SERVER] WebSocket state check', {
      readyState: ws.readyState,
      timestamp: new Date().toISOString(),
    })
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
      clearInterval(checkInterval)
    }
  }, 100) // Проверяем каждые 100ms

  // Парсим URL для получения токена
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  
  // ВАЖНО: Проверяем JWT токен для авторизации
  const token = url.searchParams.get('token')
  if (!token) {
    const errorMsg = 'Missing transcription token'
    console.error(`[WS-SERVER] ${errorMsg}`)
    recordError(errorMsg)
    clearInterval(checkInterval)
    ws.close(4001, errorMsg)
    return
  }

  // Валидируем токен и получаем данные
  const tokenData = verifyTranscriptionToken(token)
  if (!tokenData) {
    const errorMsg = 'Invalid or expired transcription token'
    console.error(`[WS-SERVER] ${errorMsg}`)
    recordError(errorMsg)
    clearInterval(checkInterval)
    ws.close(4001, errorMsg)
    return
  }

  const { sessionSlug, identity: participantIdentity } = tokenData

  console.log('[WS-SERVER] Client authenticated', {
    sessionSlug,
    identity: participantIdentity,
    userId: tokenData.userId,
    readyState: ws.readyState,
  })

  // Регистрируем клиента для получения транскриптов от серверной транскрипции
  // ВАЖНО: Клиенты НЕ создают свои Gladia сессии!
  // Серверная транскрипция создает ОДНУ Gladia сессию на комнату (в rtmp-ingest.ts или livekit-egress-transcriber.ts)
  // Клиенты просто регистрируются и получают транскрипты, которые отправляются через broadcastToSessionClients
  registerClientForSession(sessionSlug, ws)

  // Отправляем initial message клиенту после того, как соединение полностью установлено
  // Ждем события 'open' чтобы убедиться, что upgrade полностью завершен
  ws.once('open', () => {
    clearInterval(checkInterval)
    
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const message = JSON.stringify({
          type: 'connected',
          sessionSlug,
          message: 'WebSocket connection established',
        })
        ws.send(message)
        console.log('[WS-SERVER] ✅ Initial message sent to client', {
          messageLength: message.length,
          readyState: ws.readyState,
        })
      } catch (error) {
        console.error('[WS-SERVER] ❌ Failed to send initial message:', error)
      }
    }
  })
  
  // Обработчики ошибок для диагностики
  ws.on('error', (error) => {
    console.error('[WS-SERVER] WebSocket error:', {
      error: error.message,
      stack: error.stack,
      readyState: ws.readyState,
      sessionSlug,
    })
  })
  
  ws.on('close', (code, reason) => {
    console.log('[WS-SERVER] WebSocket closed', {
      code,
      reason: reason.toString(),
      readyState: ws.readyState,
      sessionSlug,
    })
    clearInterval(checkInterval)
  })

  // Настраиваем ping/pong для поддержания соединения живым
  // Heartbeat механизм с отслеживанием pong и таймаутами
  let missedPongs = 0
  const MAX_MISSED_PONGS = 3
  const PING_INTERVAL_MS = 30000 // Ping каждые 30 секунд
  const HEARTBEAT_TIMEOUT_MS = PING_INTERVAL_MS * MAX_MISSED_PONGS // 90 секунд
  
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping()
        missedPongs++
        
        // Если клиент не отвечает на pings - закрываем соединение
        if (missedPongs >= MAX_MISSED_PONGS) {
          console.warn('[WS-SERVER] Heartbeat timeout, closing connection', {
            sessionSlug,
            identity: participantIdentity,
            missedPongs,
            maxMissedPongs: MAX_MISSED_PONGS,
          })
          clearInterval(pingInterval)
          ws.close(1008, 'Heartbeat timeout')
          unregisterClient(sessionSlug, ws)
          decrementConnections()
          recordError('Heartbeat timeout')
          recordCounter('ws.heartbeat_timeouts_total')
          return
        }
      } catch (error) {
        console.error('[WS-SERVER] Failed to send ping:', error)
        clearInterval(pingInterval)
        unregisterClient(sessionSlug, ws)
        decrementConnections()
      }
    } else {
      clearInterval(pingInterval)
    }
  }, PING_INTERVAL_MS)
  
  // Отслеживаем pong для сброса счетчика missed pongs
  ws.on('pong', () => {
    missedPongs = 0 // Сбрасываем счетчик при получении pong
  })

  // Увеличиваем счетчик активных соединений
  incrementConnections()

  // Обрабатываем сообщения от клиента
  ws.on('message', (data: WebSocket.Data) => {
    // Обрабатываем только JSON сообщения (active speaker events)
    // Аудио чанки больше не обрабатываем - серверная транскрипция работает через RTMP
    if (typeof data === 'string' || (data instanceof Buffer && data[0] === 0x7B)) {
      try {
        const message = JSON.parse(data.toString())
        
        // Обрабатываем active speaker events
        if (message.type === 'active_speaker') {
          const speakerEvent: ActiveSpeakerEvent = {
            sessionSlug,
            participantIdentity: message.identity || participantIdentity,
            participantName: message.name,
            timestamp: message.timestamp || Date.now(),
          }
          updateActiveSpeaker(speakerEvent)
          return
        }
      } catch (error) {
        // Не JSON или невалидный JSON - игнорируем
      }
    }
    
    // Игнорируем аудио чанки - серверная транскрипция работает через RTMP
    // Клиенты больше не отправляют аудио через WebSocket
  })

  ws.on('close', (code, reason) => {
    clearInterval(checkInterval)
    console.log('[WS-SERVER] Client disconnected', {
      code,
      reason: reason?.toString() || 'no reason',
      sessionSlug,
      identity: participantIdentity,
      readyState: ws.readyState,
      // Коды закрытия WebSocket:
      // 1000 = Normal Closure
      // 1001 = Going Away
      // 1006 = Abnormal Closure (Railway proxy часто закрывает так)
      codeMeaning: code === 1000 ? 'Normal Closure' : code === 1001 ? 'Going Away' : code === 1006 ? 'Abnormal Closure (no close frame received)' : 'Other',
    })
    
    // Очищаем ping interval
    clearInterval(pingInterval)
    
    // Очищаем трекер для клиента
    if (participantIdentity) {
      cleanupClientTracker(participantIdentity)
    }
    
    // Уменьшаем счетчик соединений
    decrementConnections()
    // НЕ закрываем Gladia bridge - он управляется серверной транскрипцией (1 на комнату)
  })

  ws.on('error', (error) => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[WS-SERVER] WebSocket error', {
      error: errorMsg,
      readyState: ws.readyState,
      sessionSlug,
      identity: participantIdentity,
      stack: error instanceof Error ? error.stack : undefined,
    })
    console.error('[WS-SERVER] Client WebSocket error:', error)
    recordError(`Client WebSocket error: ${errorMsg}`)
    // Очищаем ping interval
    clearInterval(pingInterval)
    // Уменьшаем счетчик соединений
    decrementConnections()
    // НЕ закрываем Gladia bridge - он управляется серверной транскрипцией (1 на комнату)
  })
}

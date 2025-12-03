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
import { cleanupClientTracker } from './audio-validator.js'
import { updateActiveSpeaker, type ActiveSpeakerEvent } from './active-speaker-tracker.js'

dotenv.config()

import type { WsClientMeta } from './types.js'

// Хранилище клиентов по сессиям для отправки транскриптов от серверной транскрипции
// Используем Map<sessionSlug, Set<WsClientMeta>> для хранения метаданных о клиентах
const sessionClients = new Map<string, Set<WsClientMeta>>()

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
      console.log('[WS-SERVER] Session has no more clients, removed from registry', {
        sessionSlug,
      })
    } else {
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
 * Отправляет транскрипт всем клиентам сессии.
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

  const message = JSON.stringify(payload)
  let sentCount = 0
  
  for (const clientMeta of clients) {
    if (clientMeta.ws.readyState === WebSocket.OPEN) {
      try {
        clientMeta.ws.send(message)
        sentCount++
      } catch (error) {
        console.error('[WS-SERVER] Failed to send transcript to client:', {
          sessionSlug,
          userId: clientMeta.userId,
          error,
        })
      }
    }
  }
  
  if (sentCount > 0) {
    incrementMessagesSent()
    console.log('[WS-SERVER] Broadcast transcript', {
      sessionSlug,
      textPreview: payload.text ? payload.text.slice(0, 80) : 'no text',
      clientsInSession: clients.size,
      sent: sentCount,
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
  // Более частый ping в начале для Railway proxy
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping()
      } catch (error) {
        console.error('[WS-SERVER] Failed to send ping:', error)
        clearInterval(pingInterval)
      }
    } else {
      clearInterval(pingInterval)
    }
  }, 25000) // Ping каждые 25 секунд (стандарт RFC рекомендует 20-30 секунд)

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

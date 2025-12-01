import { WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import { createGladiaBridge, type TranscriptEvent } from './gladia-bridge.js'
import { appendTranscriptChunk } from './append-transcript-chunk.js'
import {
  incrementConnections,
  decrementConnections,
  incrementGladiaBridges,
  decrementGladiaBridges,
  incrementMessagesReceived,
  incrementMessagesSent,
  recordError,
} from './metrics'

dotenv.config()

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
function verifyTranscriptionToken(token: string): {
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
  })

  // Парсим URL для получения токена
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  
  // ВАЖНО: Проверяем JWT токен для авторизации
  const token = url.searchParams.get('token')
  if (!token) {
    const errorMsg = 'Missing transcription token'
    console.error(`[WS-SERVER] ${errorMsg}`)
    recordError(errorMsg)
    ws.close(4001, errorMsg)
    return
  }

  // Валидируем токен и получаем данные
  const tokenData = verifyTranscriptionToken(token)
  if (!tokenData) {
    const errorMsg = 'Invalid or expired transcription token'
    console.error(`[WS-SERVER] ${errorMsg}`)
    recordError(errorMsg)
    ws.close(4001, errorMsg)
    return
  }

  const { sessionSlug, identity: participantIdentity } = tokenData

  console.log('[WS-SERVER] Client authenticated', {
    sessionSlug,
    identity: participantIdentity,
    userId: tokenData.userId,
  })

  // Увеличиваем счетчик активных соединений
  incrementConnections()

  let gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  let isGladiaReady = false

  // Инициализируем Gladia bridge
  createGladiaBridge()
    .then((bridge) => {
      gladiaBridge = bridge
      isGladiaReady = true
      // Увеличиваем счетчик активных Gladia bridges
      incrementGladiaBridges()

      // Подписываемся на транскрипты от Gladia
      bridge.onTranscript(async (event: TranscriptEvent) => {
        try {
          // ВАЖНО: Отправляем транскрипт ТОЛЬКО подключенному клиенту (transcription host)
          // WebSocket сервер НЕ бродкастит транскрипты всем участникам
          // Распространение среди других участников происходит через LiveKit data channel
          // (реализовано на клиенте в useLocalParticipantTranscription)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'transcription',
              text: event.text,
              is_final: event.isFinal,
              utterance_id: event.utteranceId,
            }))
            // Увеличиваем счетчик отправленных сообщений
            incrementMessagesSent()
          }

          // ВАЖНО: Сохраняем в БД только финальные сегменты
          // Partial-ы отправляются клиенту для UI, но не сохраняются в БД
          // Это снижает нагрузку на БД в 50-100 раз (partial обновляется каждые 200-500мс)
          if (event.isFinal) {
            // Добавляем в очередь для batch-записи (неблокирующий вызов)
            // Запись произойдет асинхронно через batch-систему
            appendTranscriptChunk({
              sessionSlug,
              participantIdentity: participantIdentity || undefined,
              utteranceId: event.utteranceId,
              text: event.text,
              isFinal: true,
              startedAt: event.startedAt,
              endedAt: event.endedAt,
            }).catch((error) => {
              // Ошибка добавления в очередь (например, переполнение)
              const errorMsg = error instanceof Error ? error.message : String(error)
              console.error('[WS-SERVER] Error queueing transcript for batch insert:', error)
              recordError(`Error queueing transcript: ${errorMsg}`)
            })
            
            // Не логируем каждый финальный транскрипт (слишком много логов при высокой нагрузке)
            // Логирование происходит в batch-системе при flush
          } else {
            // Partial транскрипт - только для клиента, не сохраняем в БД
            // Логируем только периодически, чтобы не засорять логи
            if (Math.random() < 0.01) { // Логируем ~1% partial транскриптов
              console.log('[WS-SERVER] Partial transcript sent to client (not saved to DB)', {
                sessionSlug,
                utteranceId: event.utteranceId,
                textLength: event.text.length,
              })
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error('[WS-SERVER] Error processing transcript:', error)
          recordError(`Error processing transcript: ${errorMsg}`)
        }
      })
    })
    .catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[WS-SERVER] Failed to create Gladia bridge:', error)
      recordError(`Failed to create Gladia bridge: ${errorMsg}`)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to initialize transcription',
        }))
        ws.close()
      }
    })

  // Обрабатываем аудио чанки от клиента
  ws.on('message', (data: WebSocket.Data) => {
    if (!isGladiaReady || !gladiaBridge) {
      return
    }

    // Отправляем аудио в Gladia
    if (data instanceof Buffer || data instanceof ArrayBuffer) {
      gladiaBridge.sendAudio(data)
      // Увеличиваем счетчик полученных сообщений (аудио чанков)
      incrementMessagesReceived()
    }
  })

  ws.on('close', () => {
    console.log('[WS-SERVER] Client disconnected')
    // Уменьшаем счетчики при закрытии соединения
    decrementConnections()
    if (gladiaBridge) {
      gladiaBridge.close()
      decrementGladiaBridges()
    }
  })

  ws.on('error', (error) => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[WS-SERVER] Client WebSocket error:', error)
    recordError(`Client WebSocket error: ${errorMsg}`)
    // Уменьшаем счетчики при ошибке
    decrementConnections()
    if (gladiaBridge) {
      gladiaBridge.close()
      decrementGladiaBridges()
    }
  })
}

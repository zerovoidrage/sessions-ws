import { upsertParticipantByIdentity } from '../infra/participants/participants.repository'
import { getSessionById, updateSessionStatus, updateSessionActivity } from '../infra/prisma/sessions.repository'
import type { DomainUser } from '../../identity/domain/user.types'

export interface UpsertParticipantOnJoinInput {
  sessionId: string
  identity: string
  name?: string
  role?: 'HOST' | 'GUEST'
  userId?: string | null
}

/**
 * Use-case: создание или обновление участника при подключении к комнате.
 * Используется при подключении к LiveKit комнате, чтобы участник был в БД
 * до первого транскрипта.
 * 
 * Также обновляет статус сессии: CREATED → LIVE (при первом join)
 * и обновляет lastActivityAt при любом join.
 */
export async function upsertParticipantOnJoin(
  input: UpsertParticipantOnJoinInput
): Promise<{
  id: string
  sessionId: string
  identity: string
  name: string | null
  role: 'HOST' | 'GUEST'
  joinedAt: Date
}> {
  const now = new Date()
  
  // Получаем текущую сессию для проверки статуса
  const session = await getSessionById(input.sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Если сессия в статусе CREATED, переводим в LIVE и устанавливаем startedAt
  if (session.status === 'CREATED') {
    await updateSessionStatus(input.sessionId, 'LIVE', {
      startedAt: now,
      lastActivityAt: now,
    })

    // Запускаем серверную транскрипцию при первом подключении участника
    // Используем HTTP API вызов к WebSocket серверу
    // В моносервисе Next.js и WS сервер работают на одном порту (PORT), поэтому используем localhost или тот же URL
    try {
      // Для моносервиса: Next.js на PORT (3000), WS сервер на WS_PORT (3001)
      // Если WS_SERVER_URL не установлен, используем localhost с WS_PORT
      const wsPort = process.env.WS_PORT || (process.env.PORT ? String(Number(process.env.PORT) + 1) : '3001')
      const wsServerUrl = process.env.WS_SERVER_URL || `http://127.0.0.1:${wsPort}`
      console.log(`[upsertParticipantOnJoin] Attempting to start server transcription for session ${input.sessionId} via ${wsServerUrl}/api/transcription/start`, {
        envWS_SERVER_URL: process.env.WS_SERVER_URL,
        envWS_PORT: process.env.WS_PORT,
        envPORT: process.env.PORT,
        finalUrl: wsServerUrl,
      })
      
      const response = await fetch(`${wsServerUrl}/api/transcription/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: input.sessionId, sessionSlug: session.slug }),
      })
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        console.error(`[upsertParticipantOnJoin] Server transcription API returned ${response.status}: ${errorText}`)
        throw new Error(`Failed to start server transcription: HTTP ${response.status} - ${errorText}`)
      }
      
      const result = await response.json().catch(() => ({}))
      console.log(`[upsertParticipantOnJoin] ✅ Server transcription initiated via HTTP API for session ${input.sessionId}`, result)
    } catch (error) {
      console.error(`[upsertParticipantOnJoin] ❌ Failed to start server transcription for session ${input.sessionId}:`, error)
      if (error instanceof Error) {
        const wsPort = process.env.WS_PORT || (process.env.PORT ? String(Number(process.env.PORT) + 1) : '3001')
        const wsServerUrl = process.env.WS_SERVER_URL || `http://127.0.0.1:${wsPort}`
        console.error(`[upsertParticipantOnJoin] Error details:`, {
          message: error.message,
          stack: error.stack,
          wsServerUrl,
        })
      }
      // Не прерываем процесс - транскрипция не критична для подключения участника
    }
  } else {
    // При любом join обновляем lastActivityAt
    await updateSessionActivity(input.sessionId, now)
    
    // ВАЖНО: Если сессия уже LIVE, но транскрипция не запущена, попробуем запустить её
    // Это может произойти, если сервер перезапустился или транскрипция упала
    try {
      const wsPort = process.env.WS_PORT || (process.env.PORT ? String(Number(process.env.PORT) + 1) : '3001')
      const wsServerUrl = process.env.WS_SERVER_URL || `http://127.0.0.1:${wsPort}`
      console.log(`[upsertParticipantOnJoin] Session ${input.sessionId} is already LIVE, checking if transcription is active...`, {
        envWS_SERVER_URL: process.env.WS_SERVER_URL,
        envWS_PORT: process.env.WS_PORT,
        envPORT: process.env.PORT,
        finalUrl: wsServerUrl,
      })
      
      // Проверяем, активна ли транскрипция, делая запрос на start (он идемпотентный)
      const response = await fetch(`${wsServerUrl}/api/transcription/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: input.sessionId, sessionSlug: session.slug }),
      })
      
      if (response.ok) {
        const result = await response.json().catch(() => ({}))
        console.log(`[upsertParticipantOnJoin] ✅ Transcription status checked/started for LIVE session ${input.sessionId}`, result)
      } else {
        const errorText = await response.text().catch(() => response.statusText)
        console.warn(`[upsertParticipantOnJoin] Transcription start returned ${response.status} for LIVE session: ${errorText}`)
      }
    } catch (error) {
      console.warn(`[upsertParticipantOnJoin] Failed to check/start transcription for LIVE session ${input.sessionId}:`, error)
      // Не критично - просто логируем
    }
  }

  const participant = await upsertParticipantByIdentity({
    sessionId: input.sessionId,
    identity: input.identity,
    name: input.name,
    role: input.role || 'GUEST',
    userId: input.userId,
  })

  return {
    id: participant.id,
    sessionId: participant.sessionId,
    identity: participant.identity,
    name: participant.name ?? null, // Явно конвертируем undefined в null
    role: participant.role,
    joinedAt: participant.joinedAt,
  }
}


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
    try {
      const wsServerUrl = process.env.WS_SERVER_URL || 'http://localhost:3001'
      console.log(`[upsertParticipantOnJoin] Attempting to start server transcription for session ${input.sessionId} via ${wsServerUrl}/api/transcription/start`)
      
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
        console.error(`[upsertParticipantOnJoin] Error details:`, {
          message: error.message,
          stack: error.stack,
          wsServerUrl: process.env.WS_SERVER_URL || 'http://localhost:3001',
        })
      }
      // Не прерываем процесс - транскрипция не критична для подключения участника
    }
  } else {
    // При любом join обновляем lastActivityAt
    await updateSessionActivity(input.sessionId, now)
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


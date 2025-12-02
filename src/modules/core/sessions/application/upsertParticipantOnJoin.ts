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
      const response = await fetch(`${wsServerUrl}/api/transcription/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: input.sessionId, sessionSlug: session.slug }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`Failed to start server transcription: ${errorData.error || response.statusText}`)
      }
      console.log(`[upsertParticipantOnJoin] Server transcription initiated via HTTP API for session ${input.sessionId}`)
    } catch (error) {
      console.error(`[upsertParticipantOnJoin] Failed to start server transcription:`, error)
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


import { upsertParticipantByIdentity } from '../infra/participants/participants.repository'
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


import { getSessionBySlug } from './getSessionBySlug'
import { getActiveParticipantsBySessionId } from '../infra/participants/participants.repository'

export interface SelectNewTranscriptionHostInput {
  sessionSlug: string
  excludeIdentity?: string // Identity участника, который ушел (не выбирать его)
}

export interface SelectNewTranscriptionHostResult {
  newHostIdentity: string | null // null если нет доступных участников
  newHostUserId: string | null
  newHostName: string | null
}

/**
 * Выбрать нового transcription host для сессии.
 * 
 * Логика выбора:
 * 1. Сначала ищем участника с ролью HOST (который еще не ушел)
 * 2. Если такого нет, выбираем первого участника по времени подключения (joinedAt)
 * 3. Возвращаем null если нет доступных участников
 */
export async function selectNewTranscriptionHost(
  input: SelectNewTranscriptionHostInput
): Promise<SelectNewTranscriptionHostResult> {
  const session = await getSessionBySlug({ slug: input.sessionSlug })
  
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  const activeParticipants = await getActiveParticipantsBySessionId(session.id)

  // Фильтруем исключенного участника (если указан)
  const candidates = input.excludeIdentity
    ? activeParticipants.filter((p) => p.identity !== input.excludeIdentity)
    : activeParticipants

  if (candidates.length === 0) {
    return {
      newHostIdentity: null,
      newHostUserId: null,
      newHostName: null,
    }
  }

  // Приоритет 1: Ищем участника с ролью HOST
  const hostParticipant = candidates.find((p) => p.role === 'HOST')
  if (hostParticipant) {
    return {
      newHostIdentity: hostParticipant.identity,
      newHostUserId: hostParticipant.userId || null,
      newHostName: hostParticipant.name || null,
    }
  }

  // Приоритет 2: Выбираем первого участника (самый ранний joinedAt)
  const firstParticipant = candidates[0]
  return {
    newHostIdentity: firstParticipant.identity,
    newHostUserId: firstParticipant.userId || null,
    newHostName: firstParticipant.name || null,
  }
}


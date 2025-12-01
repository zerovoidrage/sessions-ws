import { getCurrentUser } from '../../identity/application/getCurrentUser'
import { getSessionBySlug } from '../application/getSessionBySlug'
import { upsertParticipantOnJoin } from '../application/upsertParticipantOnJoin'
import type { DomainUser } from '../../identity/domain/user.types'

export interface UpsertParticipantOnJoinEndpointInput {
  sessionSlug: string
  identity: string
  name?: string
  role?: 'HOST' | 'GUEST'
}

/**
 * API endpoint для создания/обновления участника при подключении к комнате.
 * Вызывается клиентом после получения LiveKit токена и перед/после room.connect().
 */
export async function upsertParticipantOnJoinEndpoint(
  user: DomainUser | null,
  input: UpsertParticipantOnJoinEndpointInput
): Promise<{
  id: string
  sessionId: string
  identity: string
  name: string | null
  role: 'HOST' | 'GUEST'
  joinedAt: Date
}> {
  // Получаем сессию по slug
  const session = await getSessionBySlug({ slug: input.sessionSlug })
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Проверяем статус сессии - нельзя присоединяться к завершенным или протухшим сессиям
  if (session.status === 'ENDED' || session.status === 'EXPIRED') {
    throw new Error('FORBIDDEN: Session has ended')
  }

  // Определяем роль:
  // - Если передан role в input (для гостей или явного указания) - используем его
  // - Если пользователь - создатель сессии, то HOST, иначе GUEST
  const role: 'HOST' | 'GUEST' = 
    input.role || (user && session.createdByUserId === user.id ? 'HOST' : 'GUEST')

  // Вызываем use-case
  return upsertParticipantOnJoin({
    sessionId: session.id,
    identity: input.identity,
    name: input.name,
    role,
    userId: user?.id || null,
  })
}


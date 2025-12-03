import { endSession } from '../application/endSession'
import { getSessionBySlug } from '../infra/prisma/sessions.repository'
import { getUserRoleInSpace } from '../../spaces/infra/spaces.repository'
import type { DomainUser } from '../../identity/domain/user.types'

/**
 * API endpoint для завершения сессии.
 * Проверяет права пользователя (OWNER/ADMIN space),
 * затем вызывает use-case endSession.
 */
export async function endSessionEndpoint(
  user: DomainUser | null,
  slug: string
): Promise<{ status: 'ok' }> {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  // Получаем сессию по slug
  const session = await getSessionBySlug({ slug })
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Идемпотентность: если сессия уже ENDED или EXPIRED, возвращаем успех
  if (session.status === 'ENDED' || session.status === 'EXPIRED') {
    return { status: 'ok' }
  }

  // Проверяем права: только OWNER space может завершить сессию
  const role = await getUserRoleInSpace(user.id, session.spaceId)
  if (role !== 'OWNER') {
    throw new Error('FORBIDDEN: Only space owner can end the session')
  }

  // Вызываем use-case с userId для записи endedByUserId
  await endSession(session.id, user.id)

  return { status: 'ok' }
}



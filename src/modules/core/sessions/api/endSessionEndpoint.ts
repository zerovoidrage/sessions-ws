import { endSession } from '../application/endSession'
import { getSessionBySlug } from '../infra/prisma/sessions.repository'
import type { DomainUser } from '../../identity/domain/user.types'

/**
 * API endpoint для завершения сессии.
 * Проверяет права пользователя (создатель сессии или owner space),
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

  // Проверяем права: создатель сессии или owner space
  // TODO: добавить проверку прав на space (owner/member)
  const isCreator = session.createdByUserId === user.id
  if (!isCreator) {
    // Можно расширить проверку прав на space позже
    throw new Error('FORBIDDEN: Only session creator can end the session')
  }

  // Вызываем use-case
  await endSession(session.id)

  return { status: 'ok' }
}



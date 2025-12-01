import { deleteSession } from '../application/deleteSession'
import { getSessionBySlug } from '../infra/prisma/sessions.repository'
import type { DomainUser } from '../../identity/domain/user.types'

export async function deleteSessionEndpoint(
  user: DomainUser | null,
  slug: string
): Promise<void> {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  // Получаем сессию по slug
  const session = await getSessionBySlug({ slug })
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  await deleteSession({
    userId: user.id,
    sessionId: session.id,
  })
}


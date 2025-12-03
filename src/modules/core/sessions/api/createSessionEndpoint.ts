import { createSession } from '../application/createSession'
import type { DomainUser } from '../../identity/domain/user.types'
import type { CreateSessionInput } from '../domain/session.types'

export async function createSessionEndpoint(
  user: DomainUser | null,
  input: { title?: string; spaceId: string }
) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return createSession({
    title: input.title,
    spaceId: input.spaceId,
    createdByUserId: user.id,
  })
}





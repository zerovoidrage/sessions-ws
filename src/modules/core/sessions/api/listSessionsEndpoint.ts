import { listSessionsBySpace } from '../application/listSessionsBySpace'
import type { DomainUser } from '../../identity/domain/user.types'

export async function listSessionsEndpoint(user: DomainUser | null, spaceId: string) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return listSessionsBySpace({
    spaceId,
    userId: user.id,
  })
}





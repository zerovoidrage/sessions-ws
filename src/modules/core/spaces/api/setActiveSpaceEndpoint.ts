import { setActiveSpaceForUser } from '../application/setActiveSpaceForUser'
import type { DomainUser } from '../../identity/domain/user.types'

export async function setActiveSpaceEndpoint(user: DomainUser | null, spaceId: string) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  await setActiveSpaceForUser(user.id, spaceId)
}





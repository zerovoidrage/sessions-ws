import { listSpacesForUser } from '../application/listSpacesForUser'
import type { DomainUser } from '../../identity/domain/user.types'

export async function listSpacesEndpoint(user: DomainUser | null) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return listSpacesForUser(user.id)
}



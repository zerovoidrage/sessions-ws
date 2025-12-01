import { renameSpace } from '../application/renameSpace'
import type { DomainUser } from '../../identity/domain/user.types'

export async function renameSpaceEndpoint(user: DomainUser | null, spaceId: string, name: string) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return renameSpace(user.id, spaceId, name)
}



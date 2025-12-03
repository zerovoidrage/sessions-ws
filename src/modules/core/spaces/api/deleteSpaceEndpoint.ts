import { deleteSpace } from '../application/deleteSpace'
import type { DomainUser } from '../../identity/domain/user.types'

export async function deleteSpaceEndpoint(user: DomainUser | null, spaceId: string) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  try {
    await deleteSpace(user.id, spaceId)
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_SPACE: Cannot delete the last space') {
      throw new Error('LAST_SPACE')
    }
    throw error
  }
}





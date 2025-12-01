import { updateSpaceMode } from '../application/updateSpaceMode'
import type { DomainUser } from '../../identity/domain/user.types'
import type { UpdateSpaceModeInput } from '../domain/space.types'

export async function updateSpaceModeEndpoint(
  user: DomainUser | null,
  spaceId: string,
  input: UpdateSpaceModeInput
) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return updateSpaceMode(user.id, spaceId, input)
}




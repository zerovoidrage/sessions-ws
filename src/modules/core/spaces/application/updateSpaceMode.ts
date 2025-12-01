import { updateMode, getUserRoleInSpace } from '../infra/spaces.repository'
import type { UpdateSpaceModeInput } from '../domain/space.types'

export async function updateSpaceMode(userId: string, spaceId: string, input: UpdateSpaceModeInput) {
  const role = await getUserRoleInSpace(userId, spaceId)
  if (role !== 'OWNER') {
    throw new Error('FORBIDDEN: Only owner can update space mode')
  }
  return updateMode(spaceId, input)
}



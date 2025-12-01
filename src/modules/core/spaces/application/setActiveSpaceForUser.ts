import { getUserRoleInSpace } from '../infra/spaces.repository'
import { setActiveSpace } from '../../identity/application/setActiveSpace'

export async function setActiveSpaceForUser(userId: string, spaceId: string): Promise<void> {
  const role = await getUserRoleInSpace(userId, spaceId)
  if (!role) {
    throw new Error('FORBIDDEN: User is not a member of this space')
  }

  await setActiveSpace(userId, spaceId)
}



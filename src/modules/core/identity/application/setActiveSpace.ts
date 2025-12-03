import { setActiveSpace as setActiveSpaceRepo } from '../infra/user.repository'

export async function setActiveSpace(userId: string, spaceId: string): Promise<void> {
  await setActiveSpaceRepo(userId, spaceId)
}





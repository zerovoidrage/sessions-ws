import { rename as renameRepo, getUserRoleInSpace } from '../infra/spaces.repository'

export async function renameSpace(userId: string, spaceId: string, name: string) {
  const role = await getUserRoleInSpace(userId, spaceId)
  if (role !== 'OWNER') {
    throw new Error('FORBIDDEN: Only owner can rename space')
  }
  return renameRepo(spaceId, name)
}




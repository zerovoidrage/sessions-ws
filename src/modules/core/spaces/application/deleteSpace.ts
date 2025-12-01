import { deleteSpace as deleteSpaceRepo, listByUser, getUserRoleInSpace } from '../infra/spaces.repository'
import { setActiveSpace } from '../../identity/application/setActiveSpace'

export async function deleteSpace(userId: string, spaceId: string): Promise<void> {
  const role = await getUserRoleInSpace(userId, spaceId)
  if (role !== 'OWNER') {
    throw new Error('FORBIDDEN: Only owner can delete space')
  }

  const userSpaces = await listByUser(userId)
  if (userSpaces.length === 1) {
    throw new Error('LAST_SPACE: Cannot delete the last space')
  }

  await deleteSpaceRepo(spaceId)

  // Если удаленный space был активным, выбираем другой
  const user = await import('@/lib/db').then(({ db }) => db.user.findUnique({
    where: { id: userId },
    select: { activeSpaceId: true },
  }))

  if (user?.activeSpaceId === spaceId) {
    const remainingSpaces = userSpaces.filter((s) => s.id !== spaceId)
    if (remainingSpaces.length > 0) {
      await setActiveSpace(userId, remainingSpaces[0].id)
    }
  }
}



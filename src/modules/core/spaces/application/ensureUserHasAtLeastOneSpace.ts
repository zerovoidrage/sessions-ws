import { listSpacesForUser } from './listSpacesForUser'
import { createSpace } from './createSpace'
import { setActiveSpace } from '../../identity/application/setActiveSpace'

export async function ensureUserHasAtLeastOneSpace(userId: string): Promise<void> {
  const spaces = await listSpacesForUser(userId)

  if (spaces.length === 0) {
    // Создаем дефолтный Space
    const defaultSpace = await createSpace(userId, {
      name: 'My space',
      mode: 'SESSIONS_ONLY',
    })
    await setActiveSpace(userId, defaultSpace.id)
  }
}





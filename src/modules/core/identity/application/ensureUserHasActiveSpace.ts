import { findById } from '../infra/user.repository'
import { listSpacesForUser } from '../../spaces/application/listSpacesForUser'
import { createSpace } from '../../spaces/application/createSpace'
import { setActiveSpace } from './setActiveSpace'

export async function ensureUserHasActiveSpace(userId: string): Promise<void> {
  const user = await findById(userId)
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  // Если уже есть activeSpaceId, ничего не делаем
  if (user.activeSpaceId) {
    return
  }

  // Получаем все spaces пользователя
  const spaces = await listSpacesForUser(userId)

  if (spaces.length === 0) {
    // Создаем дефолтный Space
    const defaultSpace = await createSpace(userId, {
      name: 'My space',
      mode: 'SESSIONS_ONLY',
    })
    await setActiveSpace(userId, defaultSpace.id)
  } else {
    // Делаем первый space активным
    await setActiveSpace(userId, spaces[0].id)
  }
}

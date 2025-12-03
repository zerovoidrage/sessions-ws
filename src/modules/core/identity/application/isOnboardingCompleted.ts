import { findById } from '../infra/user.repository'
import { listSpacesForUser } from '../../spaces/application/listSpacesForUser'

/**
 * Проверяет, пройден ли онбординг пользователем
 * Онбординг считается пройденным, если:
 * - у пользователя есть displayName (не null / не пустой)
 * - у пользователя есть хотя бы одно Space (SpaceMember с ролью OWNER)
 * - установлено activeSpaceId
 */
export async function isOnboardingCompleted(userId: string): Promise<boolean> {
  const user = await findById(userId)
  if (!user) {
    return false
  }

  // Проверяем displayName
  if (!user.displayName || user.displayName.trim().length === 0) {
    return false
  }

  // Проверяем наличие хотя бы одного Space
  const spaces = await listSpacesForUser(userId)
  if (spaces.length === 0) {
    return false
  }

  // Проверяем activeSpaceId
  if (!user.activeSpaceId) {
    return false
  }

  return true
}





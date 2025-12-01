import { updateProfile as updateProfileRepo } from '../infra/user.repository'
import type { UpdateProfileInput } from '../domain/user.types'

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  // Валидация displayName
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string') {
      throw new Error('INVALID_INPUT: displayName must be a string')
    }
    const trimmed = input.displayName.trim()
    if (trimmed.length < 2) {
      throw new Error('INVALID_INPUT: displayName must be at least 2 characters')
    }
    if (trimmed.length > 40) {
      throw new Error('INVALID_INPUT: displayName must be at most 40 characters')
    }
    input.displayName = trimmed
  }

  return updateProfileRepo(userId, input)
}


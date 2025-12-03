import { updateProfile } from '../application/updateProfile'
import type { DomainUser } from '../domain/user.types'
import type { UpdateProfileInput } from '../domain/user.types'

export async function updateProfileEndpoint(
  userId: string,
  payload: UpdateProfileInput
): Promise<DomainUser> {
  return updateProfile(userId, payload)
}


import { findById } from '../infra/user.repository'
import type { DomainUser } from '../domain/user.types'

export async function getProfileEndpoint(userId: string): Promise<DomainUser> {
  const user = await findById(userId)
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return user
}


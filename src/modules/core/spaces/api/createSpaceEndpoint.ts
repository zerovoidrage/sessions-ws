import { createSpace } from '../application/createSpace'
import type { DomainUser } from '../../identity/domain/user.types'
import type { CreateSpaceInput } from '../domain/space.types'

export async function createSpaceEndpoint(user: DomainUser | null, input: CreateSpaceInput) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return createSpace(user.id, input)
}





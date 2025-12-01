import { createForUser } from '../infra/spaces.repository'
import type { CreateSpaceInput } from '../domain/space.types'

export async function createSpace(userId: string, input: CreateSpaceInput) {
  return createForUser(userId, input)
}



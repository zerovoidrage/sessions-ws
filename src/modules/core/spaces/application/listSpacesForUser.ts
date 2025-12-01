import { listByUser } from '../infra/spaces.repository'

export async function listSpacesForUser(userId: string) {
  return listByUser(userId)
}



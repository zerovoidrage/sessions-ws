import { getTasksPlaceholder } from '../application/getTasksPlaceholder'
import type { DomainUser } from '../../identity/domain/user.types'

export async function getTasksPlaceholderEndpoint(user: DomainUser | null) {
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return getTasksPlaceholder(user.id)
}




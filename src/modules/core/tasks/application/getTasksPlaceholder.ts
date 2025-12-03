import { findById } from '../../identity/infra/user.repository'
import { getById } from '../../spaces/infra/spaces.repository'

export async function getTasksPlaceholder(userId: string) {
  const user = await findById(userId)
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  if (!user.activeSpaceId) {
    throw new Error('NO_ACTIVE_SPACE')
  }

  const space = await getById(user.activeSpaceId)
  if (!space) {
    throw new Error('SPACE_NOT_FOUND')
  }

  if (space.mode !== 'SESSIONS_AND_TASKS') {
    throw new Error('TASKS_DISABLED')
  }

  return {
    message: 'Tasks module coming soon',
  }
}


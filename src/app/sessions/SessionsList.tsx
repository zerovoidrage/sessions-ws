import { listSessionsBySpaceCached } from '@/modules/core/sessions/application/session.loaders'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'
import type { Space } from '@/modules/core/spaces/domain/space.types'
import { SessionsPageClient } from './SessionsPageClient'

interface SessionsListProps {
  user: DomainUser
  spaces: Space[]
  activeSpaceId: string
  activeSpaceMode: 'SESSIONS_ONLY' | 'SESSIONS_AND_TASKS'
}

export async function SessionsList({ user, spaces, activeSpaceId, activeSpaceMode }: SessionsListProps) {
  // Use cached loader to fetch sessions
  const sessions = await listSessionsBySpaceCached(activeSpaceId)

  return (
    <SessionsPageClient
      user={user}
      spaces={spaces}
      activeSpaceId={activeSpaceId}
      activeSpaceMode={activeSpaceMode}
      sessions={sessions}
    />
  )
}


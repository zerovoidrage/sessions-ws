import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { isOnboardingCompleted } from '@/modules/core/identity/application/isOnboardingCompleted'
import { ensureUserHasAtLeastOneSpace } from '@/modules/core/spaces/application/ensureUserHasAtLeastOneSpace'
import { listSpacesForUser } from '@/modules/core/spaces/application/listSpacesForUser'
import { listSessionsEndpoint } from '@/modules/core/sessions/api/listSessionsEndpoint'
import { SessionsPageClient } from './SessionsPageClient'

export default async function SessionsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/signin')
  }

  // Проверяем онбординг
  const onboardingCompleted = await isOnboardingCompleted(user.id)
  if (!onboardingCompleted) {
    redirect('/onboarding')
  }

  await ensureUserHasAtLeastOneSpace(user.id)

  const spaces = await listSpacesForUser(user.id)
  const activeSpaceId = user.activeSpaceId || spaces[0]?.id

  if (!activeSpaceId) {
    return <div>No active space</div>
  }

  const sessions = await listSessionsEndpoint(user, activeSpaceId)
  const activeSpace = spaces.find((s) => s.id === activeSpaceId)

  return (
    <SessionsPageClient
      user={user}
      spaces={spaces}
      activeSpaceId={activeSpaceId}
      activeSpaceMode={activeSpace?.mode || 'SESSIONS_ONLY'}
      sessions={sessions}
    />
  )
}

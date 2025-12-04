import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getCurrentUserCached } from '@/modules/core/identity/application/user.loaders'
import { isOnboardingCompleted } from '@/modules/core/identity/application/isOnboardingCompleted'
import { ensureUserHasAtLeastOneSpace } from '@/modules/core/spaces/application/ensureUserHasAtLeastOneSpace'
import { listSpacesForUserCached } from '@/modules/core/spaces/application/space.loaders'
import { SessionsList } from './SessionsList'

function SessionsSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center pt-20 pb-20">
      <div className="w-full">
        <div className="flex flex-col items-center gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse h-6 w-64 bg-white/10 rounded"
              style={{
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function SessionsPage() {
  const user = await getCurrentUserCached()

  if (!user) {
    redirect('/')
  }

  // Проверяем онбординг
  const onboardingCompleted = await isOnboardingCompleted(user.id)
  if (!onboardingCompleted) {
    redirect('/onboarding')
  }

  await ensureUserHasAtLeastOneSpace(user.id)

  const spaces = await listSpacesForUserCached(user.id)
  const activeSpaceId = user.activeSpaceId || spaces[0]?.id

  if (!activeSpaceId) {
    return <div>No active space</div>
  }

  const activeSpace = spaces.find((s) => s.id === activeSpaceId)

  return (
    <SessionsList user={user} spaces={spaces} activeSpaceId={activeSpaceId} activeSpaceMode={activeSpace?.mode || 'SESSIONS_ONLY'} />
  )
}

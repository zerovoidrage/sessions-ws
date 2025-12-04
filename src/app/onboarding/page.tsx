import { redirect } from 'next/navigation'
import { getCurrentUserCached } from '@/modules/core/identity/application/user.loaders'
import { isOnboardingCompleted } from '@/modules/core/identity/application/isOnboardingCompleted'
import { OnboardingClient } from './OnboardingClient'

export default async function OnboardingPage() {
  const user = await getCurrentUserCached()

  if (!user) {
    redirect('/')
  }

  const completed = await isOnboardingCompleted(user.id)

  if (completed) {
    redirect('/sessions')
  }

  return <OnboardingClient user={user} />
}



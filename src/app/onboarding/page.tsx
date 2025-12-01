import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { isOnboardingCompleted } from '@/modules/core/identity/application/isOnboardingCompleted'
import { OnboardingClient } from './OnboardingClient'

export default async function OnboardingPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const completed = await isOnboardingCompleted(user.id)

  if (completed) {
    redirect('/sessions')
  }

  return <OnboardingClient user={user} />
}



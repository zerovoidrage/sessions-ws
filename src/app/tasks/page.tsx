import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getById } from '@/modules/core/spaces/infra/spaces.repository'

export default async function TasksPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/signin')
  }

  if (!user.activeSpaceId) {
    redirect('/sessions')
  }

  const space = await getById(user.activeSpaceId)

  if (!space || space.mode !== 'SESSIONS_AND_TASKS') {
    return (
      <div className="min-h-screen bg-surface-900 text-white-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-4">Tasks are disabled</h1>
          <p className="text-white-600">
            Tasks are only available in spaces with SESSIONS_AND_TASKS mode.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-900 text-white-900">
      <div className="container mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-8">Tasks</h1>
        <div className="max-w-2xl">
          <div className="p-8 rounded-lg border border-onsurface-900 bg-white/5 text-center">
            <h2 className="text-xl font-medium mb-4">Tasks module coming soon</h2>
            <p className="text-white-600">
              We&apos;ll let you track action items and time based on your sessions.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}



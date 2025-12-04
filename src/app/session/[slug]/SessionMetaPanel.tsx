import type { Session } from '@/modules/core/sessions/domain/session.types'

interface SessionMetaPanelProps {
  session: Session
}

/**
 * Server Component for displaying session metadata.
 * This can be prerendered/streamed separately from the real-time client component.
 */
export async function SessionMetaPanel({ session }: SessionMetaPanelProps) {
  return (
    <div className="fixed top-4 left-4 z-50">
      <h1 className="text-sm text-white-600 px-2 py-0.5">
        {session.title || session.slug}
      </h1>
    </div>
  )
}


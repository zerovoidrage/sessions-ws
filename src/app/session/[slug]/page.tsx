import { Suspense } from 'react'
import { getSessionBySlugCached } from '@/modules/core/sessions/application/session.loaders'
import { getInitialAiInsights } from './getInitialAiInsights'
import { SessionMetaPanel } from './SessionMetaPanel'
import { SessionPageClientWrapper } from './SessionPageClientWrapper'
import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

function SessionMetaSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 bg-onsurface-700 rounded-lg" />
    </div>
  )
}

/**
 * Server component for session page.
 * 
 * Fetches session data and AI insights from DB on the server,
 * then passes them to client component for hydration.
 * This eliminates the "empty state flash" on page load.
 */
export default async function SessionPage({ params }: PageProps) {
  const { slug } = await params

  if (!slug) {
    redirect('/sessions')
  }

  // Fetch session from DB on server using cached loader (includes AI fields)
  const session = await getSessionBySlugCached(slug)

  if (!session) {
    redirect('/sessions')
  }

  // Convert session AI metadata to initial insights format
  const initialAiInsights = getInitialAiInsights(session)

  console.log('[SessionPage (server)] Fetched session for AI hydration:', {
    slug,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    hasAiTopicsJson: !!session.aiTopicsJson,
    initialAiInsights: initialAiInsights ? {
      aiTitle: initialAiInsights.aiTitle,
      currentTopic: initialAiInsights.currentTopic,
      topicsCount: initialAiInsights.topics.length,
    } : null,
  })

  return (
    <>
      <Suspense fallback={<SessionMetaSkeleton />}>
        <SessionMetaPanel session={session} />
      </Suspense>
      
      {/* Client component for real-time LiveKit + WebSocket */}
      {/* Используем wrapper с ssr: false для избежания ошибки useSession */}
      {/* SessionMetaPanel выше рендерится на сервере (SSR) */}
      <SessionPageClientWrapper sessionSlug={slug} initialAiInsights={initialAiInsights} />
    </>
  )
}

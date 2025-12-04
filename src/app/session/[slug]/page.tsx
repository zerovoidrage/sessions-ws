import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getInitialAiInsights } from './getInitialAiInsights'
import { SessionPageClient } from './SessionPageClient'
import { redirect } from 'next/navigation'

interface PageProps {
  params: { slug: string }
}

/**
 * Server component for session page.
 * 
 * Fetches session data and AI insights from DB on the server,
 * then passes them to client component for hydration.
 * This eliminates the "empty state flash" on page load.
 */
export default async function SessionPage({ params }: PageProps) {
  const slug = typeof params.slug === 'string' ? params.slug : params.slug?.[0] || ''

  if (!slug) {
    redirect('/sessions')
  }

  // Fetch session from DB on server (includes AI fields)
  const session = await getSessionBySlug({ slug })

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

  // Pass session slug and initial AI insights to client component
  // Client component will use these immediately on first render (no fetch delay)
  return <SessionPageClient sessionSlug={slug} initialAiInsights={initialAiInsights} />
}

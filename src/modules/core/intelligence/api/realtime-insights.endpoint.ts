/**
 * API endpoint handler for realtime insights.
 * 
 * This endpoint computes AI insights from a transcript window and persists them to the database.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { extractRealtimeInsights } from '../application/realtime/extractRealtimeInsights'
import type { AiInsightsInput, AiMeetingInsights } from '../domain/intelligence.types'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getSessionBySlug } from '@/modules/core/sessions/infra/prisma/sessions.repository'
import { getUserRoleInSpace } from '@/modules/core/spaces/infra/spaces.repository'
import { saveSessionAiInsights } from '@/modules/core/sessions/application/saveSessionAiInsights'

export interface RealtimeInsightsRequest {
  transcriptWindow: {
    text: string
  }
  previousInsights?: AiMeetingInsights | null
}

/**
 * POST /api/sessions/[slug]/ai/realtime-insights
 * 
 * Computes realtime AI insights from a transcript window.
 */
export async function realtimeInsightsEndpoint(
  req: NextRequest,
  params: { slug: string }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessionSlug = params.slug
    if (!sessionSlug) {
      return NextResponse.json({ error: 'Missing session slug' }, { status: 400 })
    }

    // Verify user has access to this session
    const session = await getSessionBySlug({ slug: sessionSlug })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Check user has access to the space
    const role = await getUserRoleInSpace(user.id, session.spaceId)
    if (!role) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Parse request body
    const body = (await req.json()) as RealtimeInsightsRequest
    if (!body.transcriptWindow?.text) {
      return NextResponse.json({ error: 'Missing transcriptWindow.text' }, { status: 400 })
    }

    // Build input
    const input: AiInsightsInput = {
      sessionSlug,
      transcriptWindow: {
        text: body.transcriptWindow.text,
      },
      previousInsights: body.previousInsights ?? null,
    }

    // Compute insights
    const insights = await extractRealtimeInsights(input)

    // Persist insights to database
    try {
      console.log('[Intelligence API] Saving AI insights to DB...', {
        sessionSlug,
        aiTitle: insights.aiTitle,
        currentTopic: insights.currentTopic,
        topicsCount: insights.topics.length,
      })
      await saveSessionAiInsights({ sessionSlug, insights })
      console.log('[Intelligence API] Successfully saved AI insights to DB')
    } catch (error) {
      // Log but don't fail the request - insights are computed and returned
      console.error('[Intelligence API] Failed to save AI insights:', error)
    }

    return NextResponse.json(insights)
  } catch (error) {
    console.error('[Intelligence API] Error computing realtime insights:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}


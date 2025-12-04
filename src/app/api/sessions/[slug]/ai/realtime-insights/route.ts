/**
 * API route for realtime insights.
 * 
 * POST /api/sessions/[slug]/ai/realtime-insights
 */

import { realtimeInsightsEndpoint } from '@/modules/core/intelligence/api/realtime-insights.endpoint'

export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  return realtimeInsightsEndpoint(req as any, { slug: params.slug })
}



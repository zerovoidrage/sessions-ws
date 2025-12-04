/**
 * Use-case: Save AI insights to session metadata.
 * 
 * This bridges intelligence module (domain) with sessions persistence (infra).
 */

import { getSessionBySlug } from './getSessionBySlug'
import { updateSessionAiMetadata } from '../infra/prisma/sessions.repository'
import type { AiSessionInsights } from '@/modules/core/intelligence/domain/intelligence.types'

export async function saveSessionAiInsights(params: {
  sessionSlug: string
  insights: AiSessionInsights
}): Promise<void> {
  const { sessionSlug, insights } = params

  const session = await getSessionBySlug({ slug: sessionSlug })
  if (!session) {
    console.warn('[saveSessionAiInsights] Session not found:', sessionSlug)
    return
  }

  // Если shouldUpdateTitle === false, не перетираем уже существующий aiTitle
  const nextAiTitle =
    insights.shouldUpdateTitle && insights.aiTitle
      ? insights.aiTitle
      : session.aiTitle ?? null

  // aiCurrentTopic обновляется всегда, если не null
  const aiCurrentTopic = insights.currentTopic ?? session.aiCurrentTopic ?? null

  // topics обновляются только если массив не пустой
  // Если массив пустой, сохраняем существующие topics из БД
  const aiTopicsJson =
    insights.topics && insights.topics.length > 0
      ? insights.topics
      : (session.aiTopicsJson ?? null)

  console.log('[saveSessionAiInsights] Saving AI insights:', {
    sessionSlug,
    aiTitle: nextAiTitle,
    aiCurrentTopic,
    topicsCount: insights.topics?.length ?? 0,
    shouldUpdateTitle: insights.shouldUpdateTitle,
  })

  await updateSessionAiMetadata({
    sessionId: session.id,
    aiTitle: nextAiTitle,
    aiCurrentTopic,
    aiTopicsJson,
  })
}


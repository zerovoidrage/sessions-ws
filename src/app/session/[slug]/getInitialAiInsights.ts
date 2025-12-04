/**
 * Utility to convert session data from DB to initial AI insights.
 * 
 * This bridges sessions module (infra) with intelligence module (domain).
 */

import type { Session } from '@/modules/core/sessions/domain/session.types'
import type { AiSessionInsights } from '@/modules/core/intelligence/domain/intelligence.types'
import type { AiTopic } from '@/modules/core/intelligence/domain/topic.types'

/**
 * Converts session AI metadata from DB to AiSessionInsights format.
 */
export function getInitialAiInsights(session: Session | null): AiSessionInsights | null {
  if (!session) return null

  // If we have AI metadata, reconstruct insights
  if (session.aiTopicsJson || session.aiCurrentTopic || session.aiTitle) {
    const topics: AiTopic[] = Array.isArray(session.aiTopicsJson)
      ? (session.aiTopicsJson as AiTopic[])
      : []

    const currentTopic = session.aiCurrentTopic ?? null

    // CRITICAL INVARIANT: If currentTopic is not null, topics[] MUST contain at least one topic with that label
    // This ensures UI synchronization - currentTopic and topics[] are always in sync
    let finalTopics = topics
    if (currentTopic && currentTopic.trim().length > 0) {
      const hasMatchingTopic = topics.some(t => t.label === currentTopic)
      if (!hasMatchingTopic) {
        console.warn('[getInitialAiInsights] Invariant violation: currentTopic exists but not in topics[], adding it', {
          currentTopic,
          topics: topics.map(t => t.label),
        })
        // Add currentTopic to topics[] to maintain invariant
        // Generate a stable ID for the topic
        const generateTopicId = (label: string, index: number): string => {
          const slugified = label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 30)
          return `${slugified}-${index}`
        }
        finalTopics = [
          ...topics,
          {
            id: generateTopicId(currentTopic, topics.length),
            label: currentTopic,
            startedAtSec: null,
          },
        ]
      }
    }

    return {
      aiTitle: session.aiTitle ?? null,
      aiTitleConfidence: session.aiTitle ? 0.8 : 0, // Default confidence for persisted titles
      shouldUpdateTitle: !!session.aiTitle,
      currentTopic,
      currentTopicConfidence: currentTopic ? 0.8 : 0,
      topics: finalTopics,
      topicChanged: false, // Always false for initial state
    }
  }

  return null
}


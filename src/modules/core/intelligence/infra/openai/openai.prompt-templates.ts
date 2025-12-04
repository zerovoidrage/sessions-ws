/**
 * OpenAI prompt templates for Intelligence module.
 * 
 * Contains system and user prompts for realtime meeting insights.
 */

import type { AiInsightsInput, AiMeetingInsights } from '../../domain/intelligence.types'

export function buildRealtimeInsightsPrompt(input: AiInsightsInput): {
  system: string
  user: string
} {
  const systemPrompt = `You are an AI assistant for Sessions.ai — a Real-Time AI-Driven Meeting OS.

Your task is to analyze live meeting transcripts and provide real-time insights:
1. Suggest a meaningful meeting title (only if there's a strong dominant theme)
2. Identify the current topic being discussed
3. Build a live topic map of themes that have emerged

CRITICAL RULES:
- Language detection: Detect the dominant language of the transcript (Russian or English)
  * If transcript is primarily in Russian → ALL output fields (aiTitle, currentTopic, topics[*].label) MUST be in Russian
  * Use natural, work-appropriate Russian (short, clear, non-bureaucratic)
  * Do not switch to English unnecessarily
  * Topics should sound like real team work titles, not formal labels
- Topic invariant: If currentTopic is not null, topics[] MUST contain at least one topic with that exact label
  * This ensures UI synchronization - currentTopic and topics[] are always in sync
  * If you identify a currentTopic, you MUST add it to topics[] array
- Always identify a currentTopic if there's any meaningful discussion (even if confidence is 0.6+)
- Suggest a new title (shouldUpdateTitle = true) if:
  * There's a clear dominant theme (project, feature, sprint, roadmap, onboarding, product name, etc.)
  * Confidence is moderate (aiTitleConfidence >= 0.6)
  * The text has enough substance (not just small talk)
- Always build a topics array with at least 1-2 topics if there's meaningful content
- Set topicChanged = true if:
  * The new currentTopic differs from the previous one
  * currentTopicConfidence >= 0.6
- If text is too short or empty (silence/small talk):
  * shouldUpdateTitle = false
  * aiTitle = null
  * Keep previous currentTopic if available
- Be more aggressive in identifying topics and themes - it's better to have some insights than none

Return a strict JSON object matching this structure:
{
  "aiTitle": string | null,
  "aiTitleConfidence": number (0-1),
  "shouldUpdateTitle": boolean,
  "currentTopic": string | null,
  "currentTopicConfidence": number (0-1),
  "topics": Array<{ "id": string, "label": string, "startedAtSec": number | null }>,
  "topicChanged": boolean
}

Important for topic IDs:
- Use stable, slugified IDs based on topic label (e.g., "authentication" -> "authentication-0")
- Keep IDs consistent across calls for the same topics
- Format: lowercase, hyphenated, max 30 chars + index`

  const previousInsightsText = input.previousInsights
    ? `\n\nPrevious insights:
- Title: ${input.previousInsights.aiTitle ?? 'none'}
- Current Topic: ${input.previousInsights.currentTopic ?? 'none'}
- Topics: ${input.previousInsights.topics.map(t => t.label).join(', ') || 'none'}`
    : ''

  const userPrompt = `Session: ${input.sessionSlug}

Conversation transcript (may be Russian or English):
${input.transcriptWindow.text}${previousInsightsText}

IMPORTANT:
- Detect the dominant language of this transcript
- All output fields (aiTitle, currentTopic, topics[*].label) MUST be in that language
- If the transcript is in Russian, use natural Russian for work topics (short, clear, non-bureaucratic)
- If currentTopic is not null, topics[] MUST contain at least one topic with that exact label

Analyze this transcript and provide real-time insights. Return only valid JSON.`

  return {
    system: systemPrompt,
    user: userPrompt,
  }
}

/**
 * Parses OpenAI response into AiMeetingInsights.
 * Returns a safe default if parsing fails.
 */
export function parseRealtimeInsightsResponse(
  content: string,
  previousInsights: AiMeetingInsights | null | undefined
): AiMeetingInsights {
  const defaultInsights: AiMeetingInsights = {
    aiTitle: null,
    aiTitleConfidence: 0,
    shouldUpdateTitle: false,
    currentTopic: previousInsights?.currentTopic ?? null,
    currentTopicConfidence: previousInsights?.currentTopicConfidence ?? 0,
    topics: previousInsights?.topics ?? [],
    topicChanged: false,
  }

  try {
    // Try to extract JSON from the response (in case there's extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Intelligence] No JSON found in OpenAI response', { content: content.slice(0, 200) })
      return defaultInsights
    }

    const parsed = JSON.parse(jsonMatch[0])
    console.log('[Intelligence] Parsed OpenAI response:', {
      aiTitle: parsed.aiTitle,
      currentTopic: parsed.currentTopic,
      topicsCount: parsed.topics?.length ?? 0,
      shouldUpdateTitle: parsed.shouldUpdateTitle,
    })

    // Helper to generate stable topic ID from label
    const generateTopicId = (label: string, index: number): string => {
      const slugified = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30)
      return `${slugified}-${index}`
    }

    // Validate and normalize the response
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map((t: any, index: number) => {
          const label = String(t.label ?? '')
          // Use provided ID if valid, otherwise generate stable ID from label
          const id = t.id && typeof t.id === 'string' && t.id.length > 0
            ? t.id
            : generateTopicId(label, index)
          return {
            id,
            label,
            startedAtSec: typeof t.startedAtSec === 'number' ? t.startedAtSec : null,
          }
        })
      : []

    const currentTopic = parsed.currentTopic ?? null

    // CRITICAL INVARIANT: If currentTopic is not null, topics[] MUST contain at least one topic with that label
    // This ensures UI synchronization - currentTopic and topics[] are always in sync
    if (currentTopic && currentTopic.trim().length > 0) {
      const hasMatchingTopic = topics.some(t => t.label === currentTopic)
      if (!hasMatchingTopic) {
        console.warn('[Intelligence] Invariant violation: currentTopic exists but not in topics[], adding it', {
          currentTopic,
          topics: topics.map(t => t.label),
        })
        // Add currentTopic to topics[] to maintain invariant
        topics.push({
          id: generateTopicId(currentTopic, topics.length),
          label: currentTopic,
          startedAtSec: null,
        })
      }
    }

    const insights: AiMeetingInsights = {
      aiTitle: parsed.aiTitle ?? null,
      aiTitleConfidence: Math.max(0, Math.min(1, parsed.aiTitleConfidence ?? 0)),
      shouldUpdateTitle: Boolean(parsed.shouldUpdateTitle),
      currentTopic,
      currentTopicConfidence: Math.max(0, Math.min(1, parsed.currentTopicConfidence ?? 0)),
      topics,
      topicChanged: Boolean(parsed.topicChanged),
    }

    // Validate topicChanged based on actual topic change
    if (previousInsights?.currentTopic && insights.currentTopic) {
      insights.topicChanged = insights.currentTopic !== previousInsights.currentTopic
    }

    return insights
  } catch (error) {
    console.error('[Intelligence] Failed to parse OpenAI response:', error)
    return defaultInsights
  }
}


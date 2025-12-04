/**
 * Application use case: Extract realtime insights from transcript.
 * 
 * This is the main entry point for realtime intelligence processing.
 */

import type { AiInsightsInput, AiMeetingInsights } from '../../domain/intelligence.types'
import { openaiCompletion } from '../../infra/openai/openai.client'
import { buildRealtimeInsightsPrompt, parseRealtimeInsightsResponse } from '../../infra/openai/openai.prompt-templates'

/**
 * Extracts realtime insights from a transcript window.
 * 
 * Returns default insights if text is too short or processing fails.
 */
export async function extractRealtimeInsights(
  input: AiInsightsInput
): Promise<AiMeetingInsights> {
  // Minimum text length to avoid calling AI for empty/short content
  const text = input.transcriptWindow.text.trim()
  if (text.length < 120) {
    const prev = input.previousInsights ?? null
    return {
      aiTitle: null,
      aiTitleConfidence: 0,
      shouldUpdateTitle: false,
      currentTopic: prev?.currentTopic ?? null,
      currentTopicConfidence: prev?.currentTopicConfidence ?? 0,
      topics: prev?.topics ?? [],
      topicChanged: false,
    }
  }

  try {
    // Limit transcript window to ~2000 chars to avoid huge prompts
    const limitedText = text.length > 2000 ? text.slice(-2000) : text

    const { system, user } = buildRealtimeInsightsPrompt({
      ...input,
      transcriptWindow: {
        text: limitedText,
      },
    })

    const response = await openaiCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 1000,
        responseFormat: { type: 'json_object' },
      }
    )

    return parseRealtimeInsightsResponse(response.content, input.previousInsights)
  } catch (error) {
    console.error('[Intelligence] Failed to extract realtime insights:', error)
    // Return safe default on error
    const prev = input.previousInsights ?? null
    return {
      aiTitle: null,
      aiTitleConfidence: 0,
      shouldUpdateTitle: false,
      currentTopic: prev?.currentTopic ?? null,
      currentTopicConfidence: prev?.currentTopicConfidence ?? 0,
      topics: prev?.topics ?? [],
      topicChanged: false,
    }
  }
}



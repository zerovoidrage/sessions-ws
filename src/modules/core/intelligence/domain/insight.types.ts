/**
 * Domain types for Intelligence module - Insights.
 * 
 * Realtime insights about the current session state.
 */

import type { AiTopic } from './topic.types'

export interface AiSessionInsights {
  aiTitle: string | null           // текущее предложенное AI название сессии
  aiTitleConfidence: number        // 0..1
  shouldUpdateTitle: boolean       // можно ли безопасно применять это название в UI
  currentTopic: string | null      // "Authentication", "Q1 roadmap", "Decisions", ...
  currentTopicConfidence: number   // 0..1
  topics: AiTopic[]                // Live Topic Map (список тем)
  topicChanged: boolean            // сигнал, что topic реально сменился относительно предыдущего состояния
}

// Alias for backward compatibility (deprecated, use AiSessionInsights)
export type AiMeetingInsights = AiSessionInsights

export interface AiInsightsInput {
  sessionSlug: string
  transcriptWindow: {
    text: string           // окно последних реплик (1–3 минуты) в виде plain-текста
  }
  previousInsights?: AiSessionInsights | null
}


/**
 * Hook for Session AI Engine.
 * 
 * Single source of truth for AI state on the client.
 * topics[] is the single source of truth for both CurrentTopicBubble and TopicToastStack.
 * They update in perfect sync because currentTopicLabel is always derived from the last topic in topics[].
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import type { TranscriptBubbleState } from '@/types/transcript-state'
import type { AiSessionInsights } from '@/modules/core/intelligence/domain/intelligence.types'

interface UseSessionAiEngineOptions {
  sessionSlug: string
  transcripts: TranscriptBubbleState[]
  initialInsights?: AiSessionInsights | null
}

interface UseSessionAiEngineResult {
  aiTitle: string | null
  currentTopicLabel: string | null
  topics: AiSessionInsights['topics']
  insights: AiSessionInsights | null
}

export function useSessionAiEngine({
  sessionSlug,
  transcripts,
  initialInsights,
}: UseSessionAiEngineOptions): UseSessionAiEngineResult {
  const [insights, setInsights] = useState<AiSessionInsights | null>(
    initialInsights ?? null,
  )

  const lastCallAtRef = useRef<number | null>(null)
  const charsSinceLastCallRef = useRef(0)
  const isCallingRef = useRef(false)

  // Update insights when initialInsights change (hydration from DB)
  // This happens when user re-enters a session and we fetch AI state from DB
  useEffect(() => {
    if (initialInsights) {
      console.log('[SessionAI] Initial insights from DB (hydrating):', {
        aiTitle: initialInsights.aiTitle,
        currentTopic: initialInsights.currentTopic,
        topicsCount: initialInsights.topics.length,
        topics: initialInsights.topics.map(t => t.label),
      })
      setInsights((prev) => {
        // If we don't have insights yet, use initial (hydration on first load)
        if (!prev) {
          console.log('[SessionAI] ✅ No previous insights, using initial from DB')
          return initialInsights
        }
        
        // Check if we have any meaningful data in prev
        const hasPrevData = prev.aiTitle || prev.currentTopic || prev.topics.length > 0
        const hasInitialData = initialInsights.aiTitle || initialInsights.currentTopic || initialInsights.topics.length > 0
        
        // If previous is empty but initial has data, use initial
        if (!hasPrevData && hasInitialData) {
          console.log('[SessionAI] ✅ Previous insights empty, using initial from DB')
          return initialInsights
        }
        
        // If we have data in both, merge: use prev for existing fields, initial for missing
        if (hasPrevData && hasInitialData) {
          console.log('[SessionAI] Merging initial with existing insights')
          
          // Ensure invariant: if currentTopic exists, it must be in topics[]
          let mergedTopics = prev.topics.length > 0 ? prev.topics : initialInsights.topics
          const mergedCurrentTopic = prev.currentTopic || initialInsights.currentTopic
          
          if (mergedCurrentTopic && mergedCurrentTopic.trim().length > 0) {
            const hasMatchingTopic = mergedTopics.some(t => t.label === mergedCurrentTopic)
            if (!hasMatchingTopic) {
              console.warn('[SessionAI] Invariant violation during merge: currentTopic exists but not in topics[], adding it', {
                currentTopic: mergedCurrentTopic,
                topics: mergedTopics.map(t => t.label),
              })
              // Generate stable ID
              const generateTopicId = (label: string, index: number): string => {
                const slugified = label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .slice(0, 30)
                return `${slugified}-${index}`
              }
              mergedTopics = [
                ...mergedTopics,
                {
                  id: generateTopicId(mergedCurrentTopic, mergedTopics.length),
                  label: mergedCurrentTopic,
                  startedAtSec: null,
                },
              ]
            }
          }
          
          return {
            ...prev,
            aiTitle: prev.aiTitle || initialInsights.aiTitle,
            currentTopic: mergedCurrentTopic,
            topics: mergedTopics,
          }
        }
        
        // Otherwise keep prev
        return prev
      })
    }
  }, [initialInsights])

  // 1) accumulate chars
  useEffect(() => {
    const finalChunks = transcripts.filter((t) => t.isFinal)
    const text = finalChunks.map((t) => t.text).join(' ')
    charsSinceLastCallRef.current = text.length
  }, [transcripts])

  // 2) call AI when conditions met
  useEffect(() => {
    // MIN_CHARS must match extractRealtimeInsights threshold (120) to avoid phantom calls
    const MIN_CHARS = 120
    const MIN_FINAL_MESSAGES = 3
    const MIN_INTERVAL_MS = 4000
    const MIN_NEW_CHARS = 40

    if (isCallingRef.current) return

    const finalChunks = transcripts.filter((t) => t.isFinal)
    if (finalChunks.length < MIN_FINAL_MESSAGES) return

    const windowChunks = finalChunks.slice(-20)
    const windowText = windowChunks
      .map((c) => c.text)
      .join(' ')
      .trim()

    if (!windowText || windowText.length < MIN_CHARS) return

    const now = Date.now()
    if (lastCallAtRef.current && now - lastCallAtRef.current < MIN_INTERVAL_MS) return
    if (charsSinceLastCallRef.current < MIN_NEW_CHARS) return

    isCallingRef.current = true
    lastCallAtRef.current = now

    ;(async () => {
      try {
        console.log('[SessionAI] Calling AI insights API...', {
          sessionSlug,
          textLen: windowText.length,
        })

        const res = await fetch(`/api/sessions/${sessionSlug}/ai/realtime-insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcriptWindow: { text: windowText },
            previousInsights: insights,
          }),
        })

        if (!res.ok) {
          console.warn('[SessionAI] AI insights API returned non-2xx', res.status)
          return
        }

        const data = (await res.json()) as AiSessionInsights
        console.log('[SessionAI] Received insights:', data)

        // Single setInsights call - both topics and currentTopicLabel will update in the same render
        // Note: parseRealtimeInsightsResponse already ensures invariant (currentTopic in topics[])
        setInsights((prev) => {
          if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev
          
          // Double-check invariant here as well (defense in depth)
          if (data.currentTopic && data.currentTopic.trim().length > 0) {
            const hasMatchingTopic = data.topics.some(t => t.label === data.currentTopic)
            if (!hasMatchingTopic) {
              console.warn('[SessionAI] Invariant violation in received insights: currentTopic exists but not in topics[], adding it', {
                currentTopic: data.currentTopic,
                topics: data.topics.map(t => t.label),
              })
              // Generate stable ID
              const generateTopicId = (label: string, index: number): string => {
                const slugified = label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .slice(0, 30)
                return `${slugified}-${index}`
              }
              return {
                ...data,
                topics: [
                  ...data.topics,
                  {
                    id: generateTopicId(data.currentTopic, data.topics.length),
                    label: data.currentTopic,
                    startedAtSec: null,
                  },
                ],
              }
            }
          }
          
          return data
        })
      } catch (err) {
        console.error('[SessionAI] Failed to fetch AI insights', err)
      } finally {
        isCallingRef.current = false
        charsSinceLastCallRef.current = Math.max(
          0,
          charsSinceLastCallRef.current - MIN_NEW_CHARS,
        )
      }
    })()
  }, [sessionSlug, transcripts, insights])

  // DERIVED STATE — topics[] is the single source of truth
  const topics = insights?.topics ?? []

  // currentTopicLabel ALWAYS comes from the last topic in topics[]
  // This ensures CurrentTopicBubble (top) and TopicToastStack (bottom) are in perfect sync
  // They both see the same topics[] update in the same render tick
  // 
  // CRITICAL: No fallback to insights.currentTopic - topics[] is the ONLY source of truth
  // If AI returns currentTopic but topics = [], we ignore currentTopic to maintain sync
  const currentTopicLabel =
    topics.length > 0
      ? topics[topics.length - 1].label
      : null

  // Debug logging for derived values
  useEffect(() => {
    if (topics.length > 0 || currentTopicLabel) {
      const lastTopicLabel = topics.length > 0 ? topics[topics.length - 1].label : null
      const isSynced = currentTopicLabel === lastTopicLabel
      
      console.log('[SessionAI] Derived state:', {
        topicsCount: topics.length,
        topics: topics.map(t => t.label),
        currentTopicLabel,
        lastTopicLabel,
        isSynced,
        insightsCurrentTopic: insights?.currentTopic, // For debugging - should not be used
        aiTitle: insights?.aiTitle,
      })
      
      // Warn if not synced (should never happen with our invariant)
      if (!isSynced && topics.length > 0) {
        console.warn('[SessionAI] ⚠️ SYNC ISSUE: currentTopicLabel !== lastTopicLabel', {
          currentTopicLabel,
          lastTopicLabel,
          topics: topics.map(t => t.label),
        })
      }
    }
  }, [topics, currentTopicLabel, insights?.currentTopic, insights?.aiTitle])

  return {
    aiTitle: insights?.aiTitle ?? null,
    currentTopicLabel,
    topics,
    insights,
  }
}

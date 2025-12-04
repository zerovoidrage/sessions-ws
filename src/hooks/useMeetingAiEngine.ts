/**
 * Hook for Session AI Engine.
 * 
 * Listens to transcript messages, collects transcript window,
 * and calls the realtime insights API.
 */

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { AiMeetingInsights, AiTopic } from '@/modules/core/intelligence/domain/intelligence.types'
import type { TranscriptBubbleState } from '@/types/transcript-state'

interface UseSessionAiEngineResult {
  aiTitle: string | null
  currentTopic: string | null
  topics: AiTopic[]
}

/**
 * Formats transcript messages into a readable text window.
 */
function formatTranscriptWindow(transcripts: TranscriptBubbleState[]): string {
  if (transcripts.length === 0) return ''

  // Filter only final transcripts (not interim)
  const finalTranscripts = transcripts.filter((t) => t.isFinal)

  return finalTranscripts
    .map((t) => {
      const minutes = Math.floor((Date.now() - t.timestamp) / 60000)
      const seconds = Math.floor(((Date.now() - t.timestamp) % 60000) / 1000)
      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      const speaker = t.speakerName || t.speakerId || 'Speaker'
      return `${timeStr} ${speaker}: ${t.text}`
    })
    .join('\n')
}

/**
 * Hook for realtime AI session insights.
 * 
 * @param sessionSlug - Session slug
 * @param transcripts - Array of transcript bubbles (from TranscriptContext)
 */
export function useMeetingAiEngine(
  sessionSlug: string,
  transcripts: TranscriptBubbleState[]
): UseSessionAiEngineResult {
  const [lastInsights, setLastInsights] = useState<AiMeetingInsights | null>(null)
  const [lastAiCallAt, setLastAiCallAt] = useState<number | null>(null)
  const [charsSinceLastCall, setCharsSinceLastCall] = useState(0)
  const lastMessagesLengthRef = useRef(0)
  const isCallingRef = useRef(false)

  // Filter final transcripts only
  const finalTranscripts = transcripts.filter((t) => t.isFinal)
  const recentFinalTranscripts = finalTranscripts.slice(-20)

  // Collect transcript window from last N transcripts (or last 1-3 minutes)
  const transcriptWindow = formatTranscriptWindow(recentFinalTranscripts)

  // Count unique speakers
  const uniqueSpeakers = new Set(recentFinalTranscripts.map(t => t.speakerId || t.speakerName).filter(Boolean)).size

  // Track new transcripts
  useEffect(() => {
    const newTranscriptsCount = finalTranscripts.length - lastMessagesLengthRef.current
    if (newTranscriptsCount > 0) {
      const newTranscripts = finalTranscripts.slice(-newTranscriptsCount)
      const newChars = newTranscripts.reduce((sum, t) => sum + (t.text?.length || 0), 0)
      setCharsSinceLastCall((prev) => prev + newChars)
    }
    lastMessagesLengthRef.current = finalTranscripts.length
  }, [finalTranscripts])

  // Call AI API when conditions are met
  const callAiInsights = useCallback(async () => {
    if (isCallingRef.current) return
    if (!sessionSlug) return

    const text = transcriptWindow.trim()

    // Conditions for calling API:
    // 1. Text length >= 120 chars (минимум текста для анализа)
    // 2. At least 2 different speakers OR at least 3 final messages (минимум 2 спикера ИЛИ 3 финальных сообщения)
    // 3. At least 6 seconds since last call (защита от частых вызовов)
    // 4. At least 60 new chars since last call (минимум новых данных)
    const shouldCall =
      text.length >= 120 &&
      (uniqueSpeakers >= 2 || finalTranscripts.length >= 3) &&
      (!lastAiCallAt || Date.now() - lastAiCallAt >= 6000) &&
      charsSinceLastCall >= 60

    if (!shouldCall) {
      console.log('[SessionAI] Conditions not met:', {
        textLength: text.length,
        uniqueSpeakers,
        finalMessagesCount: finalTranscripts.length, // Количество финальных сообщений
        timeSinceLastCall: lastAiCallAt ? Date.now() - lastAiCallAt : null,
        charsSinceLastCall,
        condition1: text.length >= 120,
        condition2: uniqueSpeakers >= 2 || finalTranscripts.length >= 3,
        condition3: !lastAiCallAt || Date.now() - lastAiCallAt >= 6000,
        condition4: charsSinceLastCall >= 60,
      })
      return
    }

    console.log('[SessionAI] Calling AI insights API...', {
      sessionSlug,
      textLength: text.length,
      uniqueSpeakers,
      finalTranscriptsCount: finalTranscripts.length,
    })

    isCallingRef.current = true

    try {
      const response = await fetch(`/api/sessions/${sessionSlug}/ai/realtime-insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptWindow: { text },
          previousInsights: lastInsights,
        }),
      })

      if (!response.ok) {
        console.error('[SessionAI] Failed to get insights:', response.statusText)
        return
      }

      const insights = (await response.json()) as AiMeetingInsights
      console.log('[SessionAI] Received insights:', {
        aiTitle: insights.aiTitle,
        currentTopic: insights.currentTopic,
        topicsCount: insights.topics.length,
        shouldUpdateTitle: insights.shouldUpdateTitle,
      })
      setLastInsights(insights)
      setLastAiCallAt(Date.now())
      setCharsSinceLastCall(0)
    } catch (error) {
      console.error('[SessionAI] Error calling insights API:', error)
    } finally {
      isCallingRef.current = false
    }
  }, [sessionSlug, transcriptWindow, lastInsights, lastAiCallAt, charsSinceLastCall, uniqueSpeakers, finalTranscripts.length])

  // Trigger AI call when conditions are met
  useEffect(() => {
    callAiInsights()
  }, [callAiInsights])

  return {
    aiTitle: lastInsights?.aiTitle ?? null,
    currentTopic: lastInsights?.currentTopic ?? null,
    topics: lastInsights?.topics ?? [],
  }
}


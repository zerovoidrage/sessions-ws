/**
 * Server-side AI Coordinator for Realtime Insights.
 * 
 * Centralizes AI calls on the server to prevent duplicate OpenAI API calls
 * when multiple clients are connected to the same session.
 * 
 * Architecture:
 * - Collects transcripts for each session (sliding window)
 * - Calls OpenAI API once per session (not per client)
 * - Broadcasts results to all clients via WebSocket
 * - Saves results to DB via HTTP POST to Next.js API
 */

import { broadcastToSessionClients } from './client-connection.js'
import { recordCounter, recordLatency } from './realtime-metrics.js'
import dotenv from 'dotenv'

dotenv.config()

interface TranscriptChunk {
  text: string
  timestamp: number
  utteranceId: string
}

interface SessionAiState {
  transcriptWindow: TranscriptChunk[]
  lastInsights: any | null
  lastAiCallAt: number
  charsSinceLastCall: number
  isCalling: boolean
  aiLock: boolean // Lock to prevent concurrent calls
}

// Per-session state for AI coordination
const sessionAiStates = new Map<string, SessionAiState>()

// Configuration
const MIN_CHARS_FOR_AI = 120
const DEBOUNCE_CHARS = 120
const THROTTLE_CHARS = 500
const THROTTLE_MS = 3000
const WINDOW_SIZE = 10 // Last 10 transcripts

/**
 * Initializes AI state for a session.
 */
function getOrCreateAiState(sessionSlug: string): SessionAiState {
  let state = sessionAiStates.get(sessionSlug)
  if (!state) {
    state = {
      transcriptWindow: [],
      lastInsights: null,
      lastAiCallAt: 0,
      charsSinceLastCall: 0,
      isCalling: false,
      aiLock: false,
    }
    sessionAiStates.set(sessionSlug, state)
  }
  return state
}

/**
 * Adds a transcript to the window and triggers AI if conditions are met.
 */
export function addTranscriptForAi(
  sessionSlug: string,
  text: string,
  utteranceId: string,
  isFinal: boolean
): void {
  const state = getOrCreateAiState(sessionSlug)
  
  // Only process final transcripts for AI
  if (!isFinal) {
    return
  }
  
  // Add to window
  state.transcriptWindow.push({
    text: text.trim(),
    timestamp: Date.now(),
    utteranceId,
  })
  
  // Keep only last WINDOW_SIZE transcripts
  if (state.transcriptWindow.length > WINDOW_SIZE) {
    state.transcriptWindow.shift()
  }
  
  // Update character count
  state.charsSinceLastCall += text.length
  
  // Check if we should call AI
  const windowText = state.transcriptWindow.map(t => t.text).join(' ').trim()
  const now = Date.now()
  const timeSinceLastCall = now - state.lastAiCallAt
  
  // Conditions for AI call:
  // 1. Minimum characters (debounce)
  // 2. Either throttle chars OR throttle time
  // 3. Not already calling
  // 4. Not locked by another process
  
  if (
    windowText.length >= MIN_CHARS_FOR_AI &&
    state.charsSinceLastCall >= DEBOUNCE_CHARS &&
    (state.charsSinceLastCall >= THROTTLE_CHARS || timeSinceLastCall >= THROTTLE_MS) &&
    !state.isCalling &&
    !state.aiLock
  ) {
    // Trigger AI call asynchronously
    state.isCalling = true
    state.aiLock = true
    state.lastAiCallAt = now
    state.charsSinceLastCall = 0
    
    callAiForSession(sessionSlug, windowText, state.lastInsights)
      .then((insights) => {
        state.lastInsights = insights
        state.isCalling = false
        state.aiLock = false
        
        // Broadcast insights to all clients
        broadcastAiInsights(sessionSlug, insights)
        
        // Save to DB via HTTP (async, don't wait)
        saveAiInsightsToDb(sessionSlug, insights).catch((error) => {
          console.error('[AI Coordinator] Failed to save insights to DB:', error)
        })
      })
      .catch((error) => {
        console.error('[AI Coordinator] Failed to call AI:', error)
        state.isCalling = false
        state.aiLock = false
        recordCounter('ai.coordinator_errors_total')
      })
  }
}

/**
 * Calls OpenAI API for realtime insights.
 */
async function callAiForSession(
  sessionSlug: string,
  transcriptText: string,
  previousInsights: any | null
): Promise<any> {
  const startTime = Date.now()
  
  // Limit transcript to 2000 chars
  const limitedText = transcriptText.length > 2000 ? transcriptText.slice(-2000) : transcriptText
  
  // Build prompt (simplified version - in production, use the same prompt templates)
  const systemPrompt = `You are an AI assistant that analyzes meeting transcripts in real-time.
Extract:
1. Current topic (what is being discussed now)
2. List of topics discussed (max 10, most recent first)
3. Suggested title for the meeting (if enough content)

Return JSON with: currentTopic, topics (array of {label, confidence}), aiTitle, shouldUpdateTitle.`
  
  const userPrompt = `Analyze this transcript and extract insights:\n\n${limitedText}`
  
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 500)}`)
  }
  
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No content in OpenAI response')
  }
  
  // Parse JSON response
  const insights = JSON.parse(content)
  
  const latency = Date.now() - startTime
  recordLatency('ai.coordinator_latency_ms', latency)
  recordCounter('ai.coordinator_calls_total')
  
  return {
    aiTitle: insights.aiTitle || null,
    aiTitleConfidence: insights.aiTitleConfidence || 0,
    shouldUpdateTitle: insights.shouldUpdateTitle || false,
    currentTopic: insights.currentTopic || previousInsights?.currentTopic || null,
    currentTopicConfidence: insights.currentTopicConfidence || 0,
    topics: insights.topics || previousInsights?.topics || [],
    topicChanged: insights.topicChanged || false,
  }
}

/**
 * Broadcasts AI insights to all clients in the session.
 */
function broadcastAiInsights(sessionSlug: string, insights: any): void {
  const payload = {
    type: 'ai_insights',
    sessionSlug,
    insights,
    ts: Date.now(),
  }
  
  broadcastToSessionClients(sessionSlug, payload)
  recordCounter('ai.insights_broadcast_total')
}

/**
 * Saves AI insights to DB via HTTP POST to Next.js API.
 */
async function saveAiInsightsToDb(sessionSlug: string, insights: any): Promise<void> {
  const nextjsUrl = process.env.NEXTJS_BASE_URL || process.env.VERCEL_URL
  if (!nextjsUrl) {
    console.warn('[AI Coordinator] NEXTJS_BASE_URL not set, skipping DB save')
    return
  }
  
  const url = `${nextjsUrl}/api/sessions/${sessionSlug}/ai/realtime-insights`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: In production, you'd need to pass authentication
        // For now, we'll rely on internal network security
      },
      body: JSON.stringify({
        transcriptWindow: { text: '' }, // Not needed for save
        previousInsights: insights,
      }),
    })
    
    if (!response.ok) {
      throw new Error(`Failed to save insights: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.error('[AI Coordinator] Failed to save insights to DB:', error)
    // Don't throw - this is a background operation
  }
}

/**
 * Cleans up AI state for a session (called when session ends).
 */
export function cleanupAiState(sessionSlug: string): void {
  sessionAiStates.delete(sessionSlug)
  console.log('[AI Coordinator] Cleaned up AI state for session', { sessionSlug })
}


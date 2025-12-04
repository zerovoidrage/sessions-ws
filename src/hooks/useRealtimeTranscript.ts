/**
 * Легкий хук для получения realtime-транскриптов через WebSocket.
 * 
 * Оптимизирован для минимальной задержки и производительности:
 * - Минимальный стейт (только messages + currentUtterance)
 * - Прямая подписка на WebSocket без промежуточных слоев
 * - Метрики latency на клиенте
 */

'use client'

import { useState, useEffect, useRef } from 'react'

export type TranscriptMessage = {
  id: string
  text: string
  speaker?: string
  ts: number
  lastUpdateAt?: number
  autoFinalized?: boolean
}

export type UseRealtimeTranscriptResult = {
  messages: TranscriptMessage[]
  currentUtterance: TranscriptMessage | null
}

/**
 * Получает WebSocket URL для транскрипции
 * ВАЖНО: Локально WebSocket/RTMP сервер НЕ запускается, всегда используется продовый Railway сервер
 */
function getTranscriptionWebSocketUrl(sessionSlug: string, transcriptionToken: string): string {
  const wsServerUrl = process.env.NEXT_PUBLIC_WS_SERVER_URL
  if (!wsServerUrl) {
    throw new Error('NEXT_PUBLIC_WS_SERVER_URL environment variable is required')
  }
  
  // Убираем http/https и добавляем ws/wss
  const cleanUrl = wsServerUrl.replace(/^https?:\/\//, '')
  const wsProtocol = wsServerUrl.startsWith('https') ? 'wss' : 'ws'
  const baseUrl = `${wsProtocol}://${cleanUrl}`
  
  return `${baseUrl}/api/realtime/transcribe?token=${encodeURIComponent(transcriptionToken)}`
}

/**
 * Легкий хук для получения realtime-транскриптов
 */
export function useRealtimeTranscript(
  sessionSlug: string,
  transcriptionToken?: string
): UseRealtimeTranscriptResult {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [currentUtterance, setCurrentUtterance] = useState<TranscriptMessage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5
  const currentUtteranceRef = useRef<TranscriptMessage | null>(null)

  useEffect(() => {
    if (!transcriptionToken) {
      return
    }

    let isMounted = true

    const connect = () => {
      if (!isMounted || wsRef.current?.readyState === WebSocket.OPEN) {
        return
      }

      try {
        const wsUrl = getTranscriptionWebSocketUrl(sessionSlug, transcriptionToken)
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('[useRealtimeTranscript] WebSocket connected', { sessionSlug })
          reconnectAttemptsRef.current = 0
        }

        ws.onmessage = (event: MessageEvent) => {
          if (!isMounted) return

          let data: any
          try {
            data = JSON.parse(event.data)
          } catch {
            return
          }

          // Обрабатываем только транскрипты
          if (data.type !== 'transcript' || data.sessionSlug !== sessionSlug) {
            return
          }

          const now = Date.now()
          const serverTs = data.ts ?? now
          const clientLatency = now - serverTs

          // Замер клиентской latency с предупреждениями
          if (clientLatency > 2000) {
            console.warn('[CLIENT_METRICS] ⚠️ High client-side transcript latency', {
              clientLatency,
              isFinal: data.isFinal,
              textPreview: data.text?.slice(0, 80),
              sessionSlug,
            })
          }

          const base: TranscriptMessage = {
            id: data.utteranceId ?? `${serverTs}-${Math.random().toString(16).slice(2)}`,
            text: data.text,
            speaker: data.speaker,
            ts: serverTs,
            lastUpdateAt: now,
          }

          if (data.isFinal) {
            // Финальный транскрипт
            // Проверяем, есть ли уже текущий utterance с таким же id
            setCurrentUtterance((prev) => {
              if (prev && prev.id === base.id) {
                // Обновляем существующий и добавляем в messages
                setMessages((m) => [...m, { ...base, isFinal: true }])
                return null
              }
              return prev
            })
            
            // Если не было текущего с таким id - просто добавляем в messages
            setMessages((prev) => {
              // Проверяем, нет ли уже такого сообщения
              const exists = prev.some((m) => m.id === base.id)
              if (exists) {
                return prev
              }
              return [...prev, base]
            })
            
            currentUtteranceRef.current = null
          } else {
            // Interim транскрипт - всегда показываем мгновенно как currentUtterance
            setCurrentUtterance(base)
            currentUtteranceRef.current = base
          }
        }

        ws.onerror = (error) => {
          console.error('[useRealtimeTranscript] WebSocket error', { sessionSlug, error })
        }

        ws.onclose = () => {
          if (!isMounted) return

          console.log('[useRealtimeTranscript] WebSocket closed', { sessionSlug })
          wsRef.current = null

          // Автоматическое переподключение
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++
            const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000)
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMounted) {
                connect()
              }
            }, delay)
          }
        }
      } catch (error) {
        console.error('[useRealtimeTranscript] Failed to connect WebSocket', { sessionSlug, error })
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [sessionSlug, transcriptionToken])

  // Синхронизация ref с state для авто-финализации
  useEffect(() => {
    currentUtteranceRef.current = currentUtterance
  }, [currentUtterance])

  // Авто-финализация draft сообщений через 3000ms без обновлений
  useEffect(() => {
    const interval = setInterval(() => {
      const cu = currentUtteranceRef.current
      if (!cu) return

      const now = Date.now()
      const lastUpdate = cu.lastUpdateAt ?? cu.ts
      const gap = now - lastUpdate

      if (gap > 3000) {
        // Авто-финализация: считаем draft финальным и добавляем в messages
        setMessages((prev) => [...prev, { ...cu, autoFinalized: true }])
        setCurrentUtterance(null)
        currentUtteranceRef.current = null
      }
    }, 500) // Проверяем каждые 500ms

    return () => clearInterval(interval)
  }, [])

  return { messages, currentUtterance }
}


// src/contexts/TranscriptContext.tsx
// Контекст для изоляции состояния транскрипции от остального UI

'use client'

import React, { createContext, useContext, useCallback, useRef, useState, useMemo } from 'react'
import { Room, RemoteParticipant } from 'livekit-client'
import type { TranscriptMessage } from '@/types/transcript'
import type { TranscriptState, TranscriptBubbleState } from '@/types/transcript-state'
import {
  createEmptyTranscriptState,
  updateTranscriptState,
  getTranscriptsInOrder,
} from '@/types/transcript-state'

interface TranscriptContextValue {
  /** Текущее состояние транскриптов */
  state: TranscriptState
  /** Массив транскриптов в хронологическом порядке (мемоизирован) */
  transcripts: TranscriptBubbleState[]
  /** Добавить новое сообщение транскрипта */
  addMessage: (message: TranscriptMessage) => void
  /** Общее количество транскриптов */
  totalCount: number
}

const TranscriptContext = createContext<TranscriptContextValue | null>(null)

interface TranscriptProviderProps {
  children: React.ReactNode
  sessionSlug: string
  room?: Room | null
}

/**
 * Провайдер контекста транскрипции.
 * 
 * Изолирует состояние транскрипции от остального UI, чтобы обновления транскриптов
 * не вызывали ре-рендеры VideoGrid, ControlBar и других компонентов комнаты.
 */
export function TranscriptProvider({ children, sessionSlug, room }: TranscriptProviderProps) {
  const [state, setState] = useState<TranscriptState>(createEmptyTranscriptState)

  // Мемоизируем массив транскриптов для избежания пересозданий
  const transcripts = useMemo(() => getTranscriptsInOrder(state), [state])

  const addMessage = useCallback((message: TranscriptMessage) => {
    setState((prevState) => updateTranscriptState(prevState, message))
  }, [])

  const value: TranscriptContextValue = useMemo(
    () => ({
      state,
      transcripts,
      addMessage,
      totalCount: state.totalCount,
    }),
    [state, transcripts, addMessage]
  )

  // Подписываемся на data channel для получения транскриптов
  React.useEffect(() => {
    if (!room) return

    const handleData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      // LOCAL ECHO PROTECTION: игнорируем сообщения от локального участника
      const local = room?.localParticipant
      if (local && participant && participant.identity === local.identity) {
        return
      }

      try {
        const json = JSON.parse(new TextDecoder().decode(payload))

        // Обрабатываем транскрипты
        if (json?.type === 'transcript' && json.text?.trim()) {
          const msg: TranscriptMessage = {
            id: '',
            sessionSlug,
            speakerId: json.speakerId,
            speakerName: json.speakerName ?? json.speakerId ?? 'Unknown',
            text: json.text,
            isFinal: Boolean(json.isFinal),
            timestamp: json.ts ?? Date.now(),
            utteranceId: json.utterance_id || json.utteranceId || null,
          }

          addMessage(msg)
        }
      } catch (e) {
        console.warn('[TranscriptContext] Failed to parse data message', e)
      }
    }

    room.on('dataReceived', handleData)
    return () => {
      room.off('dataReceived', handleData)
    }
  }, [room, sessionSlug, addMessage])

  return <TranscriptContext.Provider value={value}>{children}</TranscriptContext.Provider>
}

/**
 * Хук для доступа к контексту транскрипции.
 * 
 * @throws Error если используется вне TranscriptProvider
 */
export function useTranscriptContext(): TranscriptContextValue {
  const context = useContext(TranscriptContext)
  if (!context) {
    throw new Error('useTranscriptContext must be used within TranscriptProvider')
  }
  return context
}


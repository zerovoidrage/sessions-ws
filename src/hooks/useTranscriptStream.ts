// src/hooks/useTranscriptStream.ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Room } from 'livekit-client'
import type { TranscriptMessage } from '@/types/transcript'

interface UseTranscriptStreamOptions {
  roomSlug: string
  room?: Room | null
}

export function useTranscriptStream({ roomSlug, room }: UseTranscriptStreamOptions) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])

  const addMessage = useCallback((msg: TranscriptMessage) => {
    if (!msg.text || !msg.text.trim()) {
      return
    }

    const now = msg.timestamp ?? Date.now()
    const incomingText = msg.text.trim()
    const isFinal = Boolean(msg.isFinal)
    const utteranceId = msg.utteranceId || null

    setMessages((prev) => {
      // Если есть utteranceId, ищем существующий bubble с таким же utteranceId и speakerId
      if (utteranceId) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].speakerId === msg.speakerId && prev[i].utteranceId === utteranceId) {
            // Нашли существующий bubble - обновляем его
            const next = [...prev]
            const existing = next[i]
            
            // Дедупликация: если текст и isFinal не изменились - не обновляем
            if (existing.text === incomingText && existing.isFinal === isFinal) {
              return prev
            }
            
            next[i] = {
              ...existing,
              text: incomingText, // Заменяем текст на новый (Gladia шлет полный текст сегмента)
              isFinal: isFinal || existing.isFinal,
              timestamp: now,
            }
            
            return next
          }
        }
      }

      // Не нашли существующий bubble - создаем новый
      const newId = `${msg.speakerId}-${now}-${Math.random().toString(36).slice(2, 8)}`

      const bubble: TranscriptMessage = {
        ...msg,
        id: newId,
        text: incomingText,
        timestamp: now,
        isFinal,
        utteranceId,
      }

      return [...prev, bubble]
    })
  }, [])

  useEffect(() => {
    if (!room) return

    const handleData = (payload: Uint8Array, participant?: any) => {
      // LOCAL ECHO PROTECTION: игнорируем сообщения от локального участника
      const local = room?.localParticipant
      if (local && participant && participant.identity === local.identity) {
        return
      }

      try {
        const json = JSON.parse(new TextDecoder().decode(payload))
        if (json?.type !== 'transcript' || !json.text?.trim()) {
          return
        }

        const msg: TranscriptMessage = {
          id: '',
          roomSlug,
          speakerId: json.speakerId,
          speakerName: json.speakerName ?? json.speakerId ?? 'Unknown',
          text: json.text,
          isFinal: Boolean(json.isFinal),
          timestamp: json.ts ?? Date.now(),
          utteranceId: json.utterance_id || json.utteranceId || null,
        }

        addMessage(msg)
      } catch (e) {
        console.warn('[TranscriptStream] Failed to parse data message', e)
      }
    }

    room.on('dataReceived', handleData)
    return () => {
      room.off('dataReceived', handleData)
    }
  }, [room, roomSlug, addMessage])

  return {
    messages,
    addMessage,
  }
}

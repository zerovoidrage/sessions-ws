// src/hooks/useTranscriptStream.ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Room, RemoteParticipant } from 'livekit-client'
import type { TranscriptMessage } from '@/types/transcript'

interface UseTranscriptStreamOptions {
  sessionSlug: string
  room?: Room | null
}

export function useTranscriptStream({ sessionSlug, room }: UseTranscriptStreamOptions) {
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
      // СТРОГАЯ ГРУППИРОВКА ПО utteranceId (data.id от Gladia)
      // Группируем строго по utteranceId, без fallback-логики
      if (utteranceId) {
        // Ищем существующий bubble с таким же utteranceId и speakerId
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].speakerId === msg.speakerId && prev[i].utteranceId === utteranceId) {
            // Нашли существующий bubble - ОБНОВЛЯЕМ его (replace text)
            const next = [...prev]
            const existing = next[i]
            
            // Дедупликация: если текст и isFinal не изменились - не обновляем
            if (existing.text === incomingText && existing.isFinal === isFinal) {
              return prev
            }
            
            // Заменяем текст полностью: bubble.text = incoming.text (replace)
            next[i] = {
              ...existing,
              text: incomingText, // Полная замена текста (Gladia шлет полный текст сегмента)
              isFinal: isFinal || existing.isFinal,
              timestamp: now,
            }
            
            return next
          }
        }
        // Если utteranceId есть, но существующий bubble не найден - создаем новый
        // (это новый utterance от Gladia)
      }

      // Новый bubble создается только если:
      // 1. utteranceId отсутствует (null)
      // 2. utteranceId есть, но существующий bubble не найден (новый utterance)
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

    const handleData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      // LOCAL ECHO PROTECTION: игнорируем сообщения от локального участника
      const local = room?.localParticipant
      if (local && participant && participant.identity === local.identity) {
        return
      }

      try {
        const json = JSON.parse(new TextDecoder().decode(payload))
        
        console.log('[TranscriptStream] 📨 Data message received', {
          type: json?.type,
          hasText: !!json?.text,
          textLength: json?.text?.length,
          speakerId: json?.speakerId,
          participantIdentity: participant?.identity,
          localIdentity: local?.identity,
        })
        
        // Обрабатываем разные типы сообщений через data channel
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

          console.log('[TranscriptStream] ✅ Adding transcript message', {
            speakerId: msg.speakerId,
            text: msg.text.substring(0, 50),
            isFinal: msg.isFinal,
          })

          addMessage(msg)
        } else if (json?.type === 'transcription-host-changed') {
          // Координация: уведомление о смене transcription host
          // Это сообщение обрабатывается на уровне SessionContent через callback
          // Здесь мы просто логируем для отладки
          console.log('[TranscriptStream] Transcription host changed notification received', {
            newHostIdentity: json.newHostIdentity,
            newHostUserId: json.newHostUserId,
            newHostName: json.newHostName,
          })
        } else {
          console.log('[TranscriptStream] ⚠️ Unknown message type or missing text', {
            type: json?.type,
            hasText: !!json?.text,
          })
        }
      } catch (e) {
        console.warn('[TranscriptStream] Failed to parse data message', e, {
          payloadLength: payload.length,
          participantIdentity: participant?.identity,
        })
      }
    }

    room.on('dataReceived', handleData)
    return () => {
      room.off('dataReceived', handleData)
    }
  }, [room, sessionSlug, addMessage])

  return {
    messages,
    addMessage,
  }
}

// src/components/session/TranscriptSidebar.tsx
// Оптимизированный TranscriptSidebar с виртуализацией и изоляцией через контекст

'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranscriptContext } from '@/contexts/TranscriptContext'
import { TranscriptBubble } from '@/shared/ui/transcript-bubble'
import type { TranscriptBubbleState } from '@/types/transcript-state'

interface TranscriptSidebarProps {
  sessionSlug: string
}

interface ParticipantData {
  displayName?: string | null
  avatarUrl?: string | null
  noAvatarColor?: string | null
}

/**
 * Ограничение количества отображаемых транскриптов.
 * Показываем только последние 4 сообщения, старые автоматически скрываются.
 */
const MAX_VISIBLE_MESSAGES = 4

export function TranscriptSidebar({ sessionSlug }: TranscriptSidebarProps) {
  const { transcripts } = useTranscriptContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null)
  const [participantsData, setParticipantsData] = useState<Map<string, ParticipantData>>(new Map())
  const loadedParticipantsRef = useRef<Set<string>>(new Set())

  // Ограничиваем до последних 4 сообщений
  const visibleTranscripts = useMemo(() => {
    if (transcripts.length === 0) {
      return []
    }
    // Показываем только последние 4 сообщения
    return transcripts.slice(-MAX_VISIBLE_MESSAGES)
  }, [transcripts])

  // Отслеживание нового сообщения для анимации
  useEffect(() => {
    if (visibleTranscripts.length === 0) return

    const lastMessage = visibleTranscripts[visibleTranscripts.length - 1]
    const isNewMessage = !seenMessageIdsRef.current.has(lastMessage.id)

    if (isNewMessage) {
      seenMessageIdsRef.current.add(lastMessage.id)
      setAnimatingMessageId(lastMessage.id)

      setTimeout(() => {
        setAnimatingMessageId(null)
      }, 800)
    }
  }, [visibleTranscripts])

  // Автоскролл к новым сообщениям
  useEffect(() => {
    if (visibleTranscripts.length === 0) return

    const lastMessage = visibleTranscripts[visibleTranscripts.length - 1]
    const isNewMessage = lastMessageIdRef.current !== lastMessage.id

    if (isNewMessage && scrollContainerRef.current) {
      lastMessageIdRef.current = lastMessage.id

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
          }
        })
      })
    }
  }, [visibleTranscripts])


  // Загружаем данные участников для отображения аватаров
  const loadParticipantData = useCallback(
    async (speakerId: string) => {
      if (loadedParticipantsRef.current.has(speakerId)) {
        return
      }

      loadedParticipantsRef.current.add(speakerId)

      try {
        const encodedSpeakerId = encodeURIComponent(speakerId)
        const res = await fetch(`/api/sessions/${sessionSlug}/participants/${encodedSpeakerId}`)

        if (!res.ok) {
          throw new Error(`Failed to fetch participant: ${res.status}`)
        }

        const participant = await res.json()

        setParticipantsData((prev) => {
          const next = new Map(prev)
          if (participant.user) {
            next.set(speakerId, {
              displayName: participant.user.displayName,
              avatarUrl: participant.user.avatarUrl,
              noAvatarColor: participant.user.noAvatarColor,
            })
          } else {
            const guestDisplayName =
              participant.name && participant.name !== participant.identity
                ? participant.name
                : participant.identity || speakerId

            next.set(speakerId, {
              displayName: guestDisplayName,
              avatarUrl: null,
              noAvatarColor: null,
            })
          }
          return next
        })
      } catch (error) {
        console.error('Failed to load participant data:', error)
        setParticipantsData((prev) => {
          const next = new Map(prev)
          next.set(speakerId, {
            displayName: speakerId,
            avatarUrl: null,
            noAvatarColor: null,
          })
          return next
        })
        loadedParticipantsRef.current.delete(speakerId)
      }
    },
    [sessionSlug]
  )

  // Загружаем данные для всех уникальных speakerId в видимых транскриптах
  useEffect(() => {
    const uniqueSpeakerIds = new Set(visibleTranscripts.map((msg) => msg.speakerId))
    uniqueSpeakerIds.forEach((speakerId) => {
      loadParticipantData(speakerId)
    })
  }, [visibleTranscripts, loadParticipantData])

  return (
    <aside
      ref={containerRef}
      className="absolute right-0 bottom-0 w-96 flex flex-col text-white-900 pointer-events-none"
    >
      <div
        ref={scrollContainerRef}
        className="overflow-y-auto scrollbar-hide px-6 pt-6 pb-12 space-y-6"
      >
        {visibleTranscripts.length === 0 ? null : (
          <>
            {visibleTranscripts.map((bubble) => {
              const shouldAnimate = animatingMessageId === bubble.id
              const participantData = participantsData.get(bubble.speakerId)

              return (
                <TranscriptBubble
                  key={bubble.id}
                  bubble={bubble}
                  participantData={participantData}
                  shouldAnimate={shouldAnimate}
                />
              )
            })}
          </>
        )}
      </div>
    </aside>
  )
}

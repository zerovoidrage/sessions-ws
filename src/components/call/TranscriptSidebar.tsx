// src/components/call/TranscriptSidebar.tsx
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
 * Простая виртуализация: рендерим только видимые элементы + небольшой буфер.
 * Для более сложных случаев можно использовать react-virtuoso или react-window.
 */
const VISIBLE_ITEMS_COUNT = 50 // Максимум видимых элементов одновременно
const SCROLL_BUFFER = 10 // Буфер элементов сверху и снизу для плавного скролла

export function TranscriptSidebar({ sessionSlug }: TranscriptSidebarProps) {
  const { transcripts } = useTranscriptContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null)
  const [participantsData, setParticipantsData] = useState<Map<string, ParticipantData>>(new Map())
  const loadedParticipantsRef = useRef<Set<string>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // Виртуализация: определяем видимый диапазон элементов
  const visibleRange = useMemo(() => {
    if (transcripts.length === 0) {
      return { start: 0, end: 0 }
    }

    // Для начала показываем последние N элементов (новые сообщения)
    // При скролле вверх можно расширить диапазон
    const total = transcripts.length
    const start = Math.max(0, total - VISIBLE_ITEMS_COUNT - SCROLL_BUFFER)
    const end = total

    return { start, end }
  }, [transcripts.length])

  // Видимые транскрипты (мемоизированы)
  const visibleTranscripts = useMemo(() => {
    return transcripts.slice(visibleRange.start, visibleRange.end)
  }, [transcripts, visibleRange])

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

  // Отслеживание размеров контейнера для виртуализации
  useEffect(() => {
    if (!scrollContainerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    resizeObserver.observe(scrollContainerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Отслеживание скролла для виртуализации (ленивая загрузка старых сообщений)
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop
      setScrollTop(currentScrollTop)

      // При скролле вверх можно расширить видимый диапазон для загрузки старых сообщений
      // Пока используем простую реализацию: показываем последние N элементов
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [])

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
            {/* Индикатор, что есть старые сообщения (если видимый диапазон не начинается с 0) */}
            {visibleRange.start > 0 && (
              <div className="text-xs text-white-700 text-center py-2">
                {visibleRange.start} older messages...
              </div>
            )}

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

// src/components/call/TranscriptSidebar.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptMessage } from '@/types/transcript'
import { Avatar } from '@/shared/ui/avatar/Avatar'

interface TranscriptSidebarProps {
  sessionSlug: string
  messages: TranscriptMessage[]
}

interface ParticipantData {
  displayName?: string | null
  avatarUrl?: string | null
  noAvatarColor?: string | null
}

export function TranscriptSidebar({ sessionSlug, messages }: TranscriptSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null)
  const [participantsData, setParticipantsData] = useState<Map<string, ParticipantData>>(new Map())
  const loadedParticipantsRef = useRef<Set<string>>(new Set())

  // Убираем дубликаты по id перед сортировкой
  const sorted = useMemo(() => {
    const unique = new Map<string, TranscriptMessage>()
    for (const msg of messages) {
      const existing = unique.get(msg.id)
      if (!existing || msg.timestamp > existing.timestamp) {
        unique.set(msg.id, msg)
      }
    }
    return Array.from(unique.values()).sort((a, b) => a.timestamp - b.timestamp)
  }, [messages])

  // Показываем только последние 6 сообщений
  const visibleMessages = useMemo(() => {
    return sorted.slice(-6)
  }, [sorted])

  // Отслеживание нового сообщения для анимации (только последнее)
  useEffect(() => {
    if (visibleMessages.length === 0) return

    const lastMessage = visibleMessages[visibleMessages.length - 1]
    const isNewMessage = !seenMessageIdsRef.current.has(lastMessage.id)

    if (isNewMessage) {
      seenMessageIdsRef.current.add(lastMessage.id)
      setAnimatingMessageId(lastMessage.id)
      
      // Убираем анимацию через 500ms после завершения
      setTimeout(() => {
        setAnimatingMessageId(null)
      }, 800)
    }
  }, [visibleMessages])

  // Автоскролл к новым сообщениям
  useEffect(() => {
    if (visibleMessages.length === 0) return

    const lastMessage = visibleMessages[visibleMessages.length - 1]
    const isNewMessage = lastMessageIdRef.current !== lastMessage.id

    if (isNewMessage && scrollContainerRef.current) {
      lastMessageIdRef.current = lastMessage.id
      
      // Используем двойной requestAnimationFrame для гарантированного обновления DOM
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
          }
        })
      })
    }
  }, [visibleMessages])

  // Загружаем данные участников для отображения аватаров
  useEffect(() => {
    const loadParticipantData = async (speakerId: string) => {
      // Пропускаем, если данные уже загружены
      if (loadedParticipantsRef.current.has(speakerId)) {
        return
      }

      // Помечаем как загружаемый, чтобы избежать дублирующих запросов
      loadedParticipantsRef.current.add(speakerId)

      try {
        // Кодируем speakerId для безопасной передачи в URL (может содержать двоеточие, UUID и т.д.)
        // Используем encodeURIComponent для безопасной передачи через URL
        const encodedSpeakerId = encodeURIComponent(speakerId)
        const res = await fetch(`/api/sessions/${sessionSlug}/participants/${encodedSpeakerId}`)
        
        if (!res.ok) {
          // Если запрос не удался, используем базовую информацию
          throw new Error(`Failed to fetch participant: ${res.status}`)
        }
        
        const participant = await res.json()
          // Обрабатываем как случай с пользователем, так и без
          setParticipantsData((prev) => {
            const next = new Map(prev)
            if (participant.user) {
              next.set(speakerId, {
                displayName: participant.user.displayName,
                avatarUrl: participant.user.avatarUrl,
                noAvatarColor: participant.user.noAvatarColor,
              })
            } else {
              // Если нет пользователя (гость), используем имя участника из БД
              // Приоритет: participant.name > participant.identity > speakerId
              // participant.name должен быть установлен при join через /api/sessions/[slug]/participants/join
              const guestDisplayName = participant.name && participant.name !== participant.identity
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
        // При ошибке используем базовую информацию
        setParticipantsData((prev) => {
          const next = new Map(prev)
          next.set(speakerId, {
            displayName: speakerId,
            avatarUrl: null,
            noAvatarColor: null,
          })
          return next
        })
        // Убираем из загруженных при ошибке
        loadedParticipantsRef.current.delete(speakerId)
      }
    }

    // Загружаем данные для всех уникальных speakerId в сообщениях
    const uniqueSpeakerIds = new Set(visibleMessages.map((msg) => msg.speakerId))
    uniqueSpeakerIds.forEach((speakerId) => {
      loadParticipantData(speakerId)
    })
  }, [visibleMessages, sessionSlug])


  return (
    <aside 
      ref={containerRef}
      className="absolute right-0 bottom-0 w-96 flex flex-col text-white-900 pointer-events-none"
    >
      <div 
        ref={scrollContainerRef}
        className="overflow-y-auto scrollbar-hide px-6 pt-6 pb-12 space-y-6"
      >
        {visibleMessages.length === 0 ? null : (
          visibleMessages.map((msg, index) => {
            const shouldAnimate = animatingMessageId === msg.id
            
            const participantData = participantsData.get(msg.speakerId)
            const displayName = participantData?.displayName || msg.speakerName

            return (
              <div 
                key={msg.id}
                className={`relative flex gap-6 ${shouldAnimate ? 'animate-slide-up-fade-in' : ''}`}
              >
                <Avatar
                  displayName={displayName}
                  avatarUrl={participantData?.avatarUrl || null}
                  noAvatarColor={participantData?.noAvatarColor || null}
                  size="md"
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white-700 mb-1">
                    {displayName}
                  </div>
                  <div className={`text-sm  ${msg.isFinal ? 'text-white-900' : 'text-white-900 opacity-40'}`}>
                    {msg.text}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}


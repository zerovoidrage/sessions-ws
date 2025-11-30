// src/components/call/TranscriptSidebar.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptMessage } from '@/types/transcript'

interface TranscriptSidebarProps {
  roomSlug: string
  messages: TranscriptMessage[]
}

export function TranscriptSidebar({ roomSlug, messages }: TranscriptSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null)

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
            
            return (
              <div 
                key={msg.id}
                className={`relative flex gap-6 ${shouldAnimate ? 'animate-slide-up-fade-in' : ''}`}
              >
                <img 
                  src="/img/e799988ad393ba64ed050612a623ae0b.jpg"
                  alt={msg.speakerName}
                  className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white-700 mb-1">
                    {msg.speakerName}
                  </div>
                  <div className={`text-sm ${msg.isFinal ? 'text-white-900' : 'text-white-900 opacity-40'}`}>
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


/**
 * Легкий компонент для отображения realtime-транскриптов.
 * 
 * Оптимизирован для производительности:
 * - Минимальные ререндеры
 * - Простая структура DOM
 * - Виртуализация не требуется для 100 комнат (транскрипты не накапливаются бесконечно)
 */

'use client'

import React from 'react'
import { useRealtimeTranscript } from '@/hooks/useRealtimeTranscript'

type Props = {
  sessionSlug: string
  transcriptionToken?: string
  className?: string
}

export function RealtimeTranscript({ 
  sessionSlug, 
  transcriptionToken,
  className = '' 
}: Props) {
  const { messages, currentUtterance } = useRealtimeTranscript(sessionSlug, transcriptionToken)

  return (
    <div className={`flex flex-col gap-2 text-sm leading-relaxed ${className}`}>
      <div className="flex-1 overflow-y-auto space-y-1">
        {/* Финальные транскрипты */}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2">
            {m.speaker && (
              <span className="font-medium text-neutral-400 min-w-[80px]">
                {m.speaker}:
              </span>
            )}
            <span className="text-neutral-100">{m.text}</span>
          </div>
        ))}

        {/* Текущий interim транскрипт */}
        {currentUtterance && (
          <div className="flex gap-2 opacity-70">
            {currentUtterance.speaker && (
              <span className="font-medium text-neutral-400 min-w-[80px]">
                {currentUtterance.speaker}:
              </span>
            )}
            <span className="text-neutral-200">
              {currentUtterance.text}
              <span className="inline-block w-1 h-4 align-middle animate-pulse bg-neutral-500 rounded-sm ml-1" />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}


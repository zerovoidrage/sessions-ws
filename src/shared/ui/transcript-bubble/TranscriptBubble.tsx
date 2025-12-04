// src/shared/ui/transcript-bubble/TranscriptBubble.tsx
// Оптимизированный компонент пузыря транскрипта с React.memo

'use client'

import React, { memo } from 'react'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import type { TranscriptBubbleState } from '@/types/transcript-state'

interface TranscriptBubbleProps {
  /** Состояние пузыря транскрипта */
  bubble: TranscriptBubbleState
  /** Данные участника для отображения аватара */
  participantData?: {
    displayName?: string | null
    avatarUrl?: string | null
    noAvatarColor?: string | null
  } | null
  /** Флаг для анимации появления */
  shouldAnimate?: boolean
}

/**
 * Компонент пузыря транскрипта.
 * 
 * Обернут в React.memo для предотвращения ненужных ре-рендеров.
 * Перерендерится только при изменении пропсов (bubble, participantData, shouldAnimate).
 */
export const TranscriptBubble = memo<TranscriptBubbleProps>(
  function TranscriptBubble({ bubble, participantData, shouldAnimate = false }) {
    const displayName = participantData?.displayName || bubble.speakerName

    return (
      <div
        className={`relative flex gap-4 ${shouldAnimate ? 'animate-slide-up-fade-in' : ''}`}
      >
        <Avatar
          displayName={displayName}
          avatarUrl={participantData?.avatarUrl || null}
          noAvatarColor={participantData?.noAvatarColor || null}
          size="sm"
          className="flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white-700 mb-1">{displayName}</div>
          <div
            className={`text-xs ${
              bubble.isFinal ? 'text-white-900' : 'text-white-900 opacity-40'
            }`}
          >
            {bubble.text}
          </div>
        </div>
      </div>
    )
  },
  // Кастомная функция сравнения для оптимизации
  (prevProps, nextProps) => {
    // Сравниваем bubble по ключевым полям
    if (
      prevProps.bubble.id !== nextProps.bubble.id ||
      prevProps.bubble.text !== nextProps.bubble.text ||
      prevProps.bubble.isFinal !== nextProps.bubble.isFinal ||
      prevProps.bubble.timestamp !== nextProps.bubble.timestamp
    ) {
      return false // Нужен ре-рендер
    }

    // Сравниваем participantData
    if (prevProps.participantData !== nextProps.participantData) {
      const prev = prevProps.participantData
      const next = nextProps.participantData
      if (
        prev?.displayName !== next?.displayName ||
        prev?.avatarUrl !== next?.avatarUrl ||
        prev?.noAvatarColor !== next?.noAvatarColor
      ) {
        return false // Нужен ре-рендер
      }
    }

    // Сравниваем shouldAnimate
    if (prevProps.shouldAnimate !== nextProps.shouldAnimate) {
      return false // Нужен ре-рендер
    }

    return true // Ре-рендер не нужен
  }
)

TranscriptBubble.displayName = 'TranscriptBubble'


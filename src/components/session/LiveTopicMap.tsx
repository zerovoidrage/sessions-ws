/**
 * Live Topic Map component.
 * 
 * Displays a list of topics that have emerged during the conversation.
 * Positioned at the bottom left of the screen with small font.
 */

'use client'

import type { AiTopic } from '@/modules/core/intelligence/domain/intelligence.types'

interface LiveTopicMapProps {
  topics: AiTopic[]
}

export function LiveTopicMap({ topics }: LiveTopicMapProps) {
  if (!topics.length) return null

  return (
    <div className="fixed bottom-4 left-4 text-xs text-white/60 space-y-1 z-50 bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg">
      {topics.map((t) => (
        <div key={t.id}>— {t.label}</div>
      ))}
    </div>
  )
}


/**
 * Topic Toast Stack component.
 * 
 * Displays a stack of topics that have emerged during the conversation.
 * Positioned at the bottom left with smooth Framer Motion animations.
 */

'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { AiTopic } from '@/modules/core/intelligence/domain/topic.types'

interface TopicToastStackProps {
  topics: AiTopic[]
}

export function TopicToastStack({ topics }: TopicToastStackProps) {
  // Only show last 4 topics
  const lastTopics = topics.slice(-4)

  // Debug logging
  useEffect(() => {
    if (topics.length > 0) {
      const lastTopic = topics[topics.length - 1]
      console.log('[TopicToastStack] Rendering topics:', {
        totalCount: topics.length,
        lastTopicLabel: lastTopic.label,
        lastTopicId: lastTopic.id,
        last4Topics: lastTopics.map(t => t.label),
      })
    }
  }, [topics, lastTopics])

  if (lastTopics.length === 0) {
    return null
  }

  // Current topic is the last one in the array
  const currentId = topics.length > 0 ? topics[topics.length - 1].id : null

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 space-y-2">
      <AnimatePresence initial={false}>
        {lastTopics.map((topic) => {
          const isCurrent = topic.id === currentId
          return (
            <motion.div
              key={topic.id}
              initial={{ opacity: 0, x: -12, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: -10, y: 6 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24, mass: 0.7 }}
              className={cn(
                "max-w-xs py-0.5 text-xs text-white-600",
                isCurrent 
                  ? "bg-surface-900" 
                  : "bg-black/70"
              )}
              data-current={isCurrent}
            >

              <div className={cn(
                "text-sm truncate",
                isCurrent ? "text-white-900" : "text-white-600"
              )}>
                {topic.label}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}


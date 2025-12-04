/**
 * Current Topic Bubble component.
 * 
 * Displays the current topic being discussed in a centered bubble at the top of the screen.
 * Uses Framer Motion for smooth animations.
 */

'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { CaretDown } from '@phosphor-icons/react'

interface CurrentTopicBubbleProps {
  topic: string | null
}

export function CurrentTopicBubble({ topic }: CurrentTopicBubbleProps) {
  // Debug logging
  useEffect(() => {
    if (topic) {
      console.log('[CurrentTopicBubble] Rendering topic:', topic)
    }
  }, [topic])

  // Don't show if topic is empty or too generic/short
  if (!topic || topic.length < 3) {
    return null
  }

  // Filter out generic topics
  const genericTopics = ['conversation', 'general chat', 'discussion', 'talk', 'chat']
  const isGeneric = genericTopics.some(g => topic.toLowerCase().includes(g.toLowerCase()))
  if (isGeneric && topic.length < 10) {
    return null
  }

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-40 -translate-x-1/2">
      <AnimatePresence mode="wait">
        {topic && (
          <motion.div
            key={topic}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, mass: 0.6 }}
            className="inline-flex items-center gap-24 rounded-full bg-onsurface-800 px-1 py-1 pr-4 shadow-lg shadow-black/40 backdrop-blur-md"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-900 flex items-center justify-center">
                <Image
                  src="/img/logo-w.svg"
                  alt=""
                  width={14}
                  height={12}
                  className="w-3 h-3"
                />
              </div>
              <span className="text-xs text-white-900">
                {topic}
              </span>
            </div>
            <div>
              <CaretDown size={12} weight="regular" className="text-white-900" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


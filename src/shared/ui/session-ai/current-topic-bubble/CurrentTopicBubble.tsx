/**
 * Current Topic Bubble component.
 * 
 * Displays the current topic in a bubble at the bottom left.
 * Clicking expands to show topic history (Dynamic Island-style).
 * Uses Framer Motion for smooth animations.
 */

'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretUp } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { AiTopic } from '@/modules/core/intelligence/domain/topic.types'

interface CurrentTopicBubbleProps {
  topic: string | null
  topics: AiTopic[]
}

export function CurrentTopicBubble({ topic, topics }: CurrentTopicBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Все хуки должны быть до условных возвратов
  const historyTopics = useMemo(
    () =>
      topics.length > 1
        ? [...topics.slice(0, -1).slice(-4)].reverse()
        : [],
    [topics]
  )

  const hasHistory = historyTopics.length > 0
  // Показываем стрелку и возможность развернуть, если есть хотя бы одна тема
  const canExpand = topics.length > 0

  // Точный расчет ширины: только реальный контент без дублирования padding
  const expandedWidth = useMemo(() => {
    if (!canExpand) return 340
    
    // Реальные размеры:
    // - Карточка: 240px (w-60)
    // - Gap: 8px (gap-2)
    // - Padding контейнера истории: 0px (px-0)
    // - Базовая ширина текущей темы: 340px (уже включает padding бабла)
    
    const tileWidth = 240 // w-60
    const gap = 8
    const baseWidth = 340
    
    // Ширина только карточек и gaps
    const historyContentWidth = 
      (historyTopics.length * tileWidth) + 
      ((historyTopics.length > 0 ? historyTopics.length - 1 : 0) * gap)
    
    // Общая ширина = базовая + контент истории
    return baseWidth + historyContentWidth
  }, [canExpand, historyTopics.length])

  useEffect(() => {
    if (topic) {
      console.log('[CurrentTopicBubble] Rendering topic:', topic)
    }
  }, [topic])

  // Условные возвраты после всех хуков
  if (!topic || topic.length < 3) return null

  const genericTopics = ['conversation', 'general chat', 'discussion', 'talk', 'chat']
  const isGeneric = genericTopics.some(g => topic.toLowerCase().includes(g.toLowerCase()))
  if (isGeneric && topic.length < 10) return null

  const handleToggle = () => {
    if (!canExpand) return
    setIsExpanded(prev => !prev)
  }

  return (
    <div className="fixed bottom-4 left-4 z-40">
      <motion.div
        // Анимируем только ширину и scale — без borderRadius
        animate={{
          width: isExpanded && canExpand ? expandedWidth : 340,
          scale: isExpanded ? 1.01 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 520,
          damping: 40,
          mass: 0.55,
        }}
        onClick={isExpanded && canExpand ? handleToggle : undefined}
        className={cn(
          'relative flex flex-col justify-end bg-onsurface-800 hover:bg-onsurface-700 px-2 py-1 pr-4',
          'shadow-[0_18px_40px_rgba(0,0,0,0.65)]',
          'backdrop-blur-2xl',
          'overflow-hidden rounded-[24px]',
          'transition-colors duration-200',
          isExpanded && canExpand ? 'cursor-pointer' : ''
        )}
      >
        {/* История — наверху, растёт вверх */}
        <div
          className={cn(
            'relative z-[0] overflow-x-auto overflow-y-hidden',
            'transition-[max-height,opacity,margin,padding] duration-[260ms]',
            'ease-[cubic-bezier(0.22,1,0.36,1)]',
            // Скрываем скроллбар визуально, но оставляем техническую возможность скролла
            'scrollbar-hide',
            isExpanded && canExpand
              ? 'max-h-48 opacity-100 mb-4 mt-1 px-0 pb-2'
              : 'max-h-0 opacity-0 mb-0 px-0 pb-0 pointer-events-none'
          )}
        >
          <AnimatePresence>
            {isExpanded && canExpand && (
              <div className="flex gap-2 w-fit">
                {historyTopics.length > 0 ? (
                  historyTopics.map((historyTopic, index) => {
                  const formatTime = (seconds: number | null): string => {
                    if (!seconds) return '--:--'
                    const mins = Math.floor(seconds / 60)
                    const secs = Math.floor(seconds % 60)
                    return `${mins}:${secs.toString().padStart(2, '0')}`
                  }

                  return (
                    <motion.div
                      key={historyTopic.id}
                      initial={{ 
                        opacity: 0, 
                        scale: 0.6,
                        y: 20,
                      }}
                      animate={{ 
                        opacity: 1, 
                        scale: 1,
                        y: 0,
                      }}
                      exit={{ 
                        opacity: 0, 
                        scale: 0.6,
                        y: 10,
                      }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 25,
                        mass: 0.5,
                        delay: index * 0.08, // Stagger эффект
                      }}
                      className="flex-shrink-0 w-60 h-40 rounded-lg bg-onsurface-700 p-3 flex flex-col justify-between"
                    >
                      <div className="text-xs text-white-600">
                        {formatTime(historyTopic.startedAtSec)}
                      </div>
                      <div className="text-xs text-white-900 line-clamp-2 leading-tight">
                        {historyTopic.label}
                      </div>
                    </motion.div>
                  )
                  })
                ) : (
                  // Если истории нет, показываем текущую тему как карточку
                  topics.length > 0 && (() => {
                    const currentTopic = topics[topics.length - 1]
                    const formatTime = (seconds: number | null): string => {
                      if (!seconds) return '--:--'
                      const mins = Math.floor(seconds / 60)
                      const secs = Math.floor(seconds % 60)
                      return `${mins}:${secs.toString().padStart(2, '0')}`
                    }
                    return (
                      <motion.div
                        key={currentTopic.id}
                        initial={{ 
                          opacity: 0, 
                          scale: 0.6,
                          y: 20,
                        }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          y: 0,
                        }}
                        exit={{ 
                          opacity: 0, 
                          scale: 0.6,
                          y: 10,
                        }}
                        transition={{
                          type: 'spring',
                          stiffness: 400,
                          damping: 25,
                          mass: 0.5,
                        }}
                        className="flex-shrink-0 w-60 h-40 rounded-lg bg-onsurface-700 p-3 flex flex-col justify-between"
                      >
                        <div className="text-xs text-white-600">
                          {formatTime(currentTopic.startedAtSec)}
                        </div>
                        <div className="text-xs text-white-900 line-clamp-2 leading-tight">
                          {currentTopic.label}
                        </div>
                      </motion.div>
                    )
                  })()
                )}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Текущая тема — прибита к низу, ровно по центру по высоте */}
        <button
          type="button"
          className={cn(
            'relative z-[1] flex h-10 items-center justify-between gap-4',
            canExpand ? 'cursor-pointer' : 'cursor-default'
          )}
          onClick={(e) => {
            e.stopPropagation() // Предотвращаем двойной toggle
            handleToggle()
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-surface-900 flex items-center justify-center flex-shrink-0 overflow-hidden">
              <video
                src="https://cdn.dribbble.com/userupload/44748108/file/1d6225926b6e7669a48071fa8fbbb470.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
            </div>
            <span className="text-xs text-white-900 truncate">
              <span className="text-white-700">Discuss: </span>
              {topic}
            </span>
          </div>

          {canExpand && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{
                type: 'spring',
                stiffness: 480,
                damping: 32,
                mass: 0.45,
              }}
              className="flex-shrink-0"
            >
              <CaretUp size={12} weight="regular" className="text-white-900" />
            </motion.div>
          )}
        </button>
      </motion.div>
    </div>
  )
}


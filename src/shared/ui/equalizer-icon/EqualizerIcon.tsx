'use client'

import { motion } from 'framer-motion'

interface EqualizerIconProps {
  size?: number
  className?: string
}

/**
 * Simple 3-bar equalizer icon with pulsing animation.
 * Used for microphone connecting state.
 */
export function EqualizerIcon({ size = 20, className }: EqualizerIconProps) {
  const baseHeight = size * 0.6
  const bar1Variants = {
    animate: {
      scaleY: [1, 0.4, 1, 0.6, 1],
      transition: {
        duration: 1.2,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
  }
  
  const bar2Variants = {
    animate: {
      scaleY: [1, 0.4, 1, 0.6, 1],
      transition: {
        duration: 1.2,
        repeat: Infinity,
        ease: 'easeInOut',
        delay: 0.2,
      },
    },
  }
  
  const bar3Variants = {
    animate: {
      scaleY: [1, 0.4, 1, 0.6, 1],
      transition: {
        duration: 1.2,
        repeat: Infinity,
        ease: 'easeInOut',
        delay: 0.4,
      },
    },
  }

  return (
    <div className={`flex items-center justify-center gap-0.5 ${className}`} style={{ width: size, height: size }}>
      <motion.div
        variants={bar1Variants}
        animate="animate"
        style={{
          width: 2,
          height: baseHeight,
          backgroundColor: 'currentColor',
          borderRadius: 1,
          transformOrigin: 'center',
        }}
      />
      <motion.div
        variants={bar2Variants}
        animate="animate"
        style={{
          width: 2,
          height: baseHeight * 1.33,
          backgroundColor: 'currentColor',
          borderRadius: 1,
          transformOrigin: 'center',
        }}
      />
      <motion.div
        variants={bar3Variants}
        animate="animate"
        style={{
          width: 2,
          height: baseHeight * 0.83,
          backgroundColor: 'currentColor',
          borderRadius: 1,
          transformOrigin: 'center',
        }}
      />
    </div>
  )
}


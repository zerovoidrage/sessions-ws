'use client'

import { cn } from '@/lib/utils'

export interface AvatarProps {
  userId?: string
  displayName?: string | null
  avatarUrl?: string | null
  noAvatarColor?: string | null
  src?: string | null // Deprecated, используйте avatarUrl
  fallbackText?: string // Deprecated, используйте displayName
  fallbackColor?: string | null // Deprecated, используйте noAvatarColor
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
}

/**
 * Генерирует детерминированный пастельный цвет по строке (для гостей без email)
 * Использует HSL с фиксированными Saturation и Lightness
 */
function generateColorFromString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  const hue = Math.abs(hash) % 360
  const saturation = 85
  const lightness = 45
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

export function Avatar({
  userId,
  displayName,
  avatarUrl,
  noAvatarColor,
  src, // Deprecated
  fallbackText, // Deprecated
  fallbackColor, // Deprecated
  size = 'md',
  className,
}: AvatarProps) {
  // Поддержка старых пропсов для обратной совместимости
  const finalAvatarUrl = avatarUrl ?? src
  const finalDisplayName = displayName ?? fallbackText
  const finalNoAvatarColor = noAvatarColor ?? fallbackColor

  const getInitials = (text?: string | null) => {
    if (!text) return '?'
    return text
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (finalAvatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={finalAvatarUrl}
        alt={finalDisplayName || 'Avatar'}
        className={cn('rounded-full object-cover', sizeClasses[size], className)}
      />
    )
  }

  // Если цвет не передан, генерируем его из displayName (для гостей)
  const avatarColor = finalNoAvatarColor || (finalDisplayName ? generateColorFromString(finalDisplayName) : '#999999')

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-medium text-white-900',
        sizeClasses[size],
        className
      )}
      style={{
        backgroundColor: avatarColor,
      }}
    >
      {getInitials(finalDisplayName)}
    </div>
  )
}


'use client'

import { Trash } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export interface SessionCardProps {
  slug: string
  title?: string | null
  createdAt: Date
  status: 'ACTIVE' | 'ENDED'
  onClick?: () => void
  onDelete?: () => void
  className?: string
}

export function SessionCard({
  slug,
  title,
  createdAt,
  status,
  onClick,
  onDelete,
  className,
}: SessionCardProps) {
  const formatDate = (date: Date) => {
    // Проверяем валидность даты
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return 'Invalid date'
    }
    
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div
      className={cn(
        'p-4 rounded-lg border border-onsurface-900 bg-white/5 hover:bg-white/10 transition-colors relative group',
        onClick && 'cursor-pointer',
        className
      )}
    >
      <div
        onClick={onClick}
        className="flex-1"
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-white-900 font-medium text-sm">
            {title || `Session ${slug.slice(0, 8)}`}
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'px-2 py-1 rounded text-xs',
                status === 'ACTIVE'
                  ? 'bg-brand-green/20 text-brand-green'
                  : 'bg-white-700/20 text-white-700'
              )}
            >
              {status}
            </span>
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                title="Delete session"
              >
                <Trash size={16} weight="regular" className="text-white-600" />
              </button>
            )}
          </div>
        </div>
        <p className="text-white-600 text-xs">{formatDate(createdAt)}</p>
      </div>
    </div>
  )
}


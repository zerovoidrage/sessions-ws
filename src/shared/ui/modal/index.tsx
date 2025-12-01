'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  className?: string
}

export function Modal({ isOpen, onClose, children, title, className }: ModalProps) {
  // Закрытие по Escape
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // Блокировка скролла body при открытой модалке
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        // Закрываем модалку при клике на backdrop
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal content */}
      <div
        className={cn(
          'relative z-10 w-full max-w-md bg-surface-800 rounded-lg shadow-lg',
          className
        )}
        onClick={(e) => {
          // Предотвращаем закрытие при клике на содержимое модалки
          e.stopPropagation()
        }}
      >
        {title && (
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white-900">{title}</h2>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}



'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface StartSessionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const StartSessionButton = forwardRef<HTMLButtonElement, StartSessionButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center',
          'bg-white-900 text-surface-900',
          'text-[13px] uppercase',
          'w-[260px] h-[44px]',
          'rounded-full',
          'px-6 py-0 pl-2',
          'transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90',
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

StartSessionButton.displayName = 'StartSessionButton'


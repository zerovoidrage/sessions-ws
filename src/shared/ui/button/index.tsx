'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center rounded-full justify-center font-regular transition-all disabled:opacity-50 disabled:cursor-not-allowed'
    
    const variants = {
      primary: 'bg-white-900 text-surface-900 hover:opacity-90',
      secondary: 'bg-onsurface-800 text-white-900 hover:bg-onsurface-700',
      ghost: 'text-white-900 hover:bg-white/10',
      danger: 'bg-brand-red text-white-900 hover:opacity-90',
    }
    
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-3 py-0.5 text-xl',
      lg: 'px-5 py-3 text-sm',
    }

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'


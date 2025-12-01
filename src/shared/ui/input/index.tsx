import React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Все стандартные пропсы input уже включены через extends
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'w-full px-4 py-2 rounded-sm',
          'bg-onsurface-900 border border-onsurface-950',
          'text-white-900 text-callout',
          'placeholder:text-white-700',
          'hover:bg-onsurface-800',
          'focus:outline-none focus:border-onsurface-800 focus:text-white-900',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'


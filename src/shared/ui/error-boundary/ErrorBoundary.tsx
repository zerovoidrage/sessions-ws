// src/shared/ui/error-boundary/ErrorBoundary.tsx
// Error Boundary для отлова ошибок React компонентов

'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error Boundary компонент для отлова и обработки ошибок React.
 * 
 * Использование:
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Логируем ошибку
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)

    // Вызываем callback для внешней обработки (например, Sentry)
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    // Отправляем ошибки в Sentry (если настроен)
    if (typeof window !== 'undefined') {
      try {
        // Динамический импорт Sentry, чтобы не ломать сборку если Sentry не настроен
        import('@sentry/nextjs').then((Sentry) => {
          Sentry.captureException(error, {
            contexts: {
              react: {
                componentStack: errorInfo.componentStack,
              },
            },
          })
        }).catch(() => {
          // Sentry не установлен или не настроен - игнорируем
        })
      } catch {
        // Игнорируем ошибки импорта Sentry
      }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
          <div className="max-w-md w-full p-6 rounded-lg border border-white/10 bg-white/5">
            <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
            <p className="text-white-600 mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-white-700 mb-2">
                  Error details (dev only)
                </summary>
                <pre className="text-xs text-white-500 bg-black/20 p-3 rounded overflow-auto max-h-40">
                  {this.state.error.toString()}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="mt-4 px-4 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}


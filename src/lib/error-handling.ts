// src/lib/error-handling.ts
// Централизованная обработка ошибок с интеграцией Sentry

/**
 * Логирует ошибку в консоль и отправляет в Sentry (если настроен).
 */
export function logError(error: Error, context?: Record<string, unknown>): void {
  console.error('[Error]', error, context)

  // Отправляем в Sentry (динамический импорт, чтобы не ломать сборку без Sentry)
  if (typeof window !== 'undefined') {
    import('@sentry/nextjs')
      .then((Sentry) => {
        Sentry.captureException(error, {
          contexts: {
            additional: context || {},
          },
        })
      })
      .catch(() => {
        // Sentry не установлен - игнорируем
      })
  }
}

/**
 * Логирует сообщение (не ошибку) в Sentry.
 */
export function logMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    import('@sentry/nextjs')
      .then((Sentry) => {
        Sentry.captureMessage(message, {
          level,
          contexts: {
            additional: context || {},
          },
        })
      })
      .catch(() => {
        // Sentry не установлен - игнорируем
      })
  }
}

/**
 * Обертка для async функций с обработкой ошибок.
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), context)
    return null
  }
}


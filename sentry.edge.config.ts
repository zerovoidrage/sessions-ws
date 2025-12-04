// sentry.edge.config.ts
// Конфигурация Sentry для Edge runtime (middleware, edge functions)

import * as Sentry from '@sentry/nextjs'

// Инициализируем Sentry только в production
if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    
    // Настройки трассировки (меньше для edge)
    tracesSampleRate: 0.05,
    
    // Настройки окружения
    environment: 'production',
  })
}


// sentry.edge.config.ts
// Конфигурация Sentry для Edge runtime (middleware, edge functions)

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Настройки трассировки (меньше для edge)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
  
  // Настройки окружения
  environment: process.env.NODE_ENV,
  
  // Отладочная информация в dev
  debug: process.env.NODE_ENV === 'development',
})


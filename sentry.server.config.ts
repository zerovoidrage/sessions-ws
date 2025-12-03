// sentry.server.config.ts
// Конфигурация Sentry для серверной части (Next.js API routes)

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Настройки трассировки
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Настройки окружения
  environment: process.env.NODE_ENV,
  
  // Отладочная информация в dev
  debug: process.env.NODE_ENV === 'development',
  
  // Фильтрация ошибок на сервере
  beforeSend(event, hint) {
    // Можно добавить дополнительную фильтрацию для сервера
    return event
  },
})


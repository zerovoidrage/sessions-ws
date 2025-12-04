// sentry.server.config.ts
// Конфигурация Sentry для серверной части (Next.js API routes)

import * as Sentry from '@sentry/nextjs'

// Инициализируем Sentry только в production
if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    
    // Настройки трассировки
    tracesSampleRate: 0.1,
    
    // Настройки окружения
    environment: 'production',
    
    // Фильтрация ошибок на сервере
    beforeSend(event, hint) {
      // Можно добавить дополнительную фильтрацию для сервера
      return event
    },
  })
}


// sentry.client.config.ts
// Конфигурация Sentry для клиентской части (браузер)

import * as Sentry from '@sentry/nextjs'

// Инициализируем Sentry только в production
if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    
    // Настройки трассировки
    tracesSampleRate: 0.1, // 10% в production
    
    // Настройки профилирования
    profilesSampleRate: 0.1,
    
    // Интеграции
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    
    // Настройки окружения
    environment: 'production',
    
    // Фильтрация ошибок
    beforeSend(event, hint) {
      // Игнорируем ошибки из браузерных расширений
      if (event.exception) {
        const error = hint.originalException
        if (error instanceof Error) {
          // Игнорируем ошибки от расширений браузера
          if (
            error.message.includes('chrome-extension://') ||
            error.message.includes('moz-extension://') ||
            error.message.includes('safari-extension://')
          ) {
            return null
          }
        }
      }
      return event
    },
  })
}


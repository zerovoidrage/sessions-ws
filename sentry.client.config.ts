// sentry.client.config.ts
// Конфигурация Sentry для клиентской части (браузер)

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Настройки трассировки
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 10% в production, 100% в dev
  
  // Настройки профилирования
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Интеграции
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  
  // Настройки окружения
  environment: process.env.NODE_ENV,
  
  // Отладочная информация в dev
  debug: process.env.NODE_ENV === 'development',
  
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


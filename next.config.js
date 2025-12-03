// @ts-check

const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Исключаем серверные модули из клиентского bundle
    if (!isServer) {
      // @discordjs/opus содержит нативные зависимости и не может работать в браузере
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@discordjs/opus': false,
      }
      
      // Исключаем ws/server из клиентского bundle
      config.resolve.alias = {
        ...config.resolve.alias,
        '@/ws/server': false,
        '../../../../ws/server': false,
      }
    }
    
    // Исключаем ws/server из серверного bundle тоже
    // Используем externals для того, чтобы webpack не пытался разрешить эти модули
    if (isServer) {
      config.externals = config.externals || []
      // Добавляем паттерн для исключения ws/server из bundle
      config.externals.push(({ request }, callback) => {
        if (request && request.includes('ws/server')) {
          return callback(null, `commonjs ${request}`)
        }
        callback()
      })
    }
    
    return config
  },
}

// Оборачиваем конфиг в Sentry только если DSN настроен
const withSentry = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
  ? withSentryConfig
  : (config) => config

module.exports = withSentry(nextConfig, {
  // Sentry настройки для webpack плагина
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Отключаем автозагрузку Sentry в dev (можно включать для тестирования)
  disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
  disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',
  // Скрываем source maps для production (опционально, для безопасности)
  hideSourceMaps: true,
  // Ширина путей для source maps (опционально)
  widenClientFileUpload: true,
})





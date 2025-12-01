// @ts-check

const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sentry опции
  sentry: {
    // Отключаем автозагрузку Sentry в dev (можно включать для тестирования)
    disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
    disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',
    // Скрываем source maps для production (опционально, для безопасности)
    hideSourceMaps: true,
    // Ширина путей для source maps (опционально)
    widenClientFileUpload: true,
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
})





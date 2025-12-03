// ws-server/server/env.ts
/**
 * Утилиты для работы с переменными окружения.
 */

/**
 * Проверяет, включен ли тестовый режим (dev-only).
 * 
 * В тестовом режиме:
 * - Сервер отправляет фейковые транскрипты для отладки
 * - Не запускает реальную транскрипцию через LiveKit
 * 
 * ВАЖНО: В production (Railway) этот режим должен быть отключен.
 * Для production используем NODE_ENV=production или явно не устанавливаем WS_TEST_MODE.
 * 
 * @returns {boolean} true если тестовый режим включен (только для dev), false иначе
 */
export function isTestModeEnabled(): boolean {
  // В production всегда false, даже если переменная установлена
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  // Проверяем переменную окружения
  const raw = process.env.WS_TEST_MODE || process.env.WS_ENABLE_TEST_BROADCAST // обратная совместимость
  const enabled = raw === 'true' || raw === '1'

  if (enabled) {
    console.warn('[WS-ENV] ⚠️ DEV TEST MODE ENABLED - fake transcripts will be sent, real LiveKit transcription will be skipped')
    console.warn('[WS-ENV] ⚠️ This mode is for local development only and should never be used in production')
  }

  return enabled
}

/**
 * @deprecated Используйте isTestModeEnabled() вместо этой функции
 * Оставлено для обратной совместимости
 */
export function isTestBroadcastEnabled(): boolean {
  return isTestModeEnabled()
}


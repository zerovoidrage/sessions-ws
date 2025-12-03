// ws-server/server/env.ts
/**
 * Утилиты для работы с переменными окружения.
 */

/**
 * Проверяет, включен ли тестовый broadcast режим.
 * В тестовом режиме сервер отправляет фейковые транскрипты и не запускает реальную транскрипцию через LiveKit.
 */
export function isTestBroadcastEnabled(): boolean {
  const raw = process.env.WS_ENABLE_TEST_BROADCAST
  return raw === 'true' || raw === '1'
}


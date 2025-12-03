/**
 * Централизованная конфигурация LiveKit для серверного окружения.
 * 
 * Используется всеми модулями, которые создают LiveKit серверные клиенты:
 * - EgressClient
 * - RoomServiceClient
 * - любые другие серверные SDK клиенты
 * 
 * ВАЖНО: Не создавать JWT токены вручную. LiveKit серверный SDK делает это автоматически
 * используя apiKey и apiSecret.
 */

export interface LiveKitConfig {
  wsUrl: string // e.g. "wss://omni-pxx5e1ko.livekit.cloud"
  httpUrl: string // e.g. "https://omni-pxx5e1ko.livekit.cloud"
  apiKey: string
  apiSecret: string
}

/**
 * Получает и валидирует конфигурацию LiveKit из переменных окружения.
 * 
 * @throws {Error} Если отсутствуют обязательные переменные окружения или URL некорректны
 * @returns {LiveKitConfig} Валидированная конфигурация LiveKit
 */
export function getLiveKitConfig(): LiveKitConfig {
  // Поддержка разных имен переменных для обратной совместимости
  const wsUrl = process.env.LIVEKIT_WS_URL || 
                process.env.NEXT_PUBLIC_LIVEKIT_URL || 
                process.env.LIVEKIT_HTTP_URL

  // Для EgressClient и RoomServiceClient (REST API) нужно преобразовать WSS -> HTTPS
  let httpUrl = wsUrl
  if (httpUrl) {
    httpUrl = httpUrl.trim()
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
  }

  // Также проверяем, есть ли отдельная переменная для HTTP URL
  if (process.env.LIVEKIT_HTTP_URL && !process.env.LIVEKIT_HTTP_URL.startsWith('ws')) {
    httpUrl = process.env.LIVEKIT_HTTP_URL.trim()
  }

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  // Валидация: проверяем наличие всех обязательных полей
  const missing: string[] = []
  if (!wsUrl) {
    missing.push('LIVEKIT_WS_URL or NEXT_PUBLIC_LIVEKIT_URL or LIVEKIT_HTTP_URL')
  }
  if (!httpUrl) {
    missing.push('httpUrl (derived from wsUrl or LIVEKIT_HTTP_URL)')
  }
  if (!apiKey) {
    missing.push('LIVEKIT_API_KEY')
  }
  if (!apiSecret) {
    missing.push('LIVEKIT_API_SECRET')
  }

  if (missing.length > 0) {
    throw new Error(
      `[LiveKitEnv] Missing required LiveKit environment variables: ${missing.join(', ')}\n` +
      `Please set these variables in your environment (e.g., Railway service environment variables).`
    )
  }

  // Валидация формата URL
  if (!wsUrl.startsWith('ws') && !wsUrl.startsWith('wss')) {
    throw new Error(
      `[LiveKitEnv] LIVEKIT_WS_URL must start with ws:// or wss://, got: ${wsUrl}\n` +
      `Example: wss://omni-pxx5e1ko.livekit.cloud`
    )
  }

  if (!httpUrl.startsWith('http://') && !httpUrl.startsWith('https://')) {
    throw new Error(
      `[LiveKitEnv] LIVEKIT_HTTP_URL (derived) must start with http:// or https://, got: ${httpUrl}\n` +
      `This is derived from LIVEKIT_WS_URL, or you can set LIVEKIT_HTTP_URL directly.`
    )
  }

  // Логируем только безопасную информацию (без секретов)
  console.info('[LiveKitEnv] ✅ Loaded LiveKit configuration', {
    wsUrl,
    httpUrl,
    apiKeyPrefix: apiKey.slice(0, 4) + '...',
    apiKeyLength: apiKey.length,
    secretLength: apiSecret.length,
    hasApiKey: !!apiKey,
    hasApiSecret: !!apiSecret,
  })

  return {
    wsUrl,
    httpUrl,
    apiKey,
    apiSecret,
  }
}


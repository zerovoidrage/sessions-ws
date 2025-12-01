/**
 * Утилита для подключения к WebSocket с retry-логикой.
 * Используется для транскрипции, чтобы автоматически переподключаться при ошибках.
 */

export interface ConnectWebSocketOptions {
  maxRetries?: number
  baseDelayMs?: number
  timeoutMs?: number
}

const DEFAULT_OPTIONS: Required<ConnectWebSocketOptions> = {
  maxRetries: 5,
  baseDelayMs: 1000,
  timeoutMs: 10000, // 10 секунд таймаут на подключение
}

/**
 * Подключается к WebSocket с retry-логикой (экспоненциальный backoff).
 * 
 * @param wsUrl URL WebSocket сервера
 * @param options Опции для retry-логики
 * @returns Promise с подключенным WebSocket
 * @throws Error если не удалось подключиться после всех попыток
 */
export async function connectTranscriptionWebSocket(
  wsUrl: string,
  options: ConnectWebSocketOptions = {}
): Promise<WebSocket> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      console.log(`[WebSocket] Attempting to connect (attempt ${attempt + 1}/${opts.maxRetries + 1})`, { wsUrl })

      const ws = new WebSocket(wsUrl)

      // Обещание, которое резолвится при успешном подключении или реджектится при ошибке
      const connectionPromise = new Promise<WebSocket>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error(`WebSocket connection timeout after ${opts.timeoutMs}ms`))
        }, opts.timeoutMs)

        ws.onopen = () => {
          clearTimeout(timeout)
          console.log(`[WebSocket] Connected successfully (attempt ${attempt + 1})`)
          resolve(ws)
        }

        ws.onerror = (error) => {
          clearTimeout(timeout)
          console.error(`[WebSocket] Connection error (attempt ${attempt + 1}):`, error)
          reject(new Error(`WebSocket connection error: ${error}`))
        }

        ws.onclose = (event) => {
          clearTimeout(timeout)
          // Если закрылось до onopen, это ошибка
          if (event.code !== 1000) {
            reject(new Error(`WebSocket closed unexpectedly: code=${event.code}, reason=${event.reason || 'unknown'}`))
          }
        }
      })

      const connectedWs = await connectionPromise
      return connectedWs
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // Если это последняя попытка, выбрасываем ошибку
      if (attempt >= opts.maxRetries) {
        console.error(`[WebSocket] Failed to connect after ${opts.maxRetries + 1} attempts:`, lastError)
        throw new Error(`Failed to connect to WebSocket after ${opts.maxRetries + 1} attempts: ${lastError.message}`)
      }

      // Вычисляем задержку с экспоненциальным backoff
      const delay = opts.baseDelayMs * Math.pow(2, attempt)
      console.log(`[WebSocket] Retrying in ${delay}ms... (attempt ${attempt + 1}/${opts.maxRetries + 1})`)
      
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // Этот код не должен выполниться, но TypeScript требует
  throw lastError || new Error('Failed to connect to WebSocket')
}



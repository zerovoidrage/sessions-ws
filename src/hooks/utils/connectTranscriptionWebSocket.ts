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
 * Возвращает человекочитаемое описание кода закрытия WebSocket
 */
function getCloseCodeMeaning(code: number): string {
  const meanings: Record<number, string> = {
    1000: 'Normal Closure',
    1001: 'Going Away',
    1002: 'Protocol Error',
    1003: 'Unsupported Data',
    1004: 'Reserved',
    1005: 'No Status Received',
    1006: 'Abnormal Closure (network error, timeout)',
    1007: 'Invalid Frame Payload Data',
    1008: 'Policy Violation (invalid token, auth failed)',
    1009: 'Message Too Big',
    1010: 'Mandatory Extension',
    1011: 'Internal Server Error',
    1012: 'Service Restart',
    1013: 'Try Again Later',
    1014: 'Bad Gateway',
    1015: 'TLS Handshake',
  }
  return meanings[code] || `Unknown code: ${code}`
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
          console.error(`[WebSocket] Connection error (attempt ${attempt + 1}):`, {
            error,
            errorType: error?.type || 'unknown',
            url: wsUrl,
            readyState: ws.readyState,
          })
          reject(new Error(`WebSocket connection error: ${error?.type || 'unknown error'}`))
        }

        ws.onclose = (event) => {
          clearTimeout(timeout)
          
          // Коды закрытия WebSocket:
          // 1000 - нормальное закрытие
          // 1001 - ушел (going away)
          // 1006 - ненормальное закрытие (сеть, таймаут)
          // 1008 - политика нарушена (неверный токен, авторизация)
          // 1011 - внутренняя ошибка сервера
          const isError = event.code !== 1000 && event.code !== 1001
          
          if (isError) {
            console.error(`[WebSocket] Connection closed with error (attempt ${attempt + 1}):`, {
              code: event.code,
              reason: event.reason || 'no reason',
              wasClean: event.wasClean,
              url: wsUrl.replace(/token=[^&]+/, 'token=***'),
              codeMeaning: getCloseCodeMeaning(event.code),
            })
            reject(new Error(`WebSocket closed unexpectedly: code=${event.code}, reason=${event.reason || 'unknown'}`))
          } else {
            // Нормальное закрытие - логируем как info, не error
            console.log(`[WebSocket] Connection closed normally (attempt ${attempt + 1}):`, {
              code: event.code,
              reason: event.reason || 'no reason',
              wasClean: event.wasClean,
            })
            // Для нормального закрытия тоже реджектим, чтобы retry сработал
            reject(new Error(`WebSocket closed: code=${event.code}`))
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



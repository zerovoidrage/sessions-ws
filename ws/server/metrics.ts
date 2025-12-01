// ws/server/metrics.ts
// Система метрик для мониторинга WebSocket сервера транскрипции

export interface Metrics {
  activeConnections: number
  activeGladiaBridges: number
  totalMessagesReceived: number
  totalMessagesSent: number
  totalErrors: number
  lastError?: {
    message: string
    timestamp: Date
  }
  uptime: number // время работы сервера в секундах
}

const serverStartTime = Date.now()

const metrics: Metrics = {
  activeConnections: 0,
  activeGladiaBridges: 0,
  totalMessagesReceived: 0,
  totalMessagesSent: 0,
  totalErrors: 0,
  uptime: 0,
}

/**
 * Увеличивает счетчик активных соединений
 */
export function incrementConnections(): void {
  metrics.activeConnections++
}

/**
 * Уменьшает счетчик активных соединений
 */
export function decrementConnections(): void {
  metrics.activeConnections = Math.max(0, metrics.activeConnections - 1)
}

/**
 * Увеличивает счетчик активных Gladia bridges
 */
export function incrementGladiaBridges(): void {
  metrics.activeGladiaBridges++
}

/**
 * Уменьшает счетчик активных Gladia bridges
 */
export function decrementGladiaBridges(): void {
  metrics.activeGladiaBridges = Math.max(0, metrics.activeGladiaBridges - 1)
}

/**
 * Увеличивает счетчик полученных сообщений (аудио чанков)
 */
export function incrementMessagesReceived(): void {
  metrics.totalMessagesReceived++
}

/**
 * Увеличивает счетчик отправленных сообщений (транскриптов)
 */
export function incrementMessagesSent(): void {
  metrics.totalMessagesSent++
}

/**
 * Записывает ошибку в метрики
 */
export function recordError(message: string): void {
  metrics.totalErrors++
  metrics.lastError = {
    message,
    timestamp: new Date(),
  }
}

/**
 * Возвращает текущие метрики (с обновленным uptime)
 */
export function getMetrics(): Metrics {
  return {
    ...metrics,
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
  }
}

/**
 * Сбрасывает все метрики (используется для тестирования или при перезапуске)
 */
export function resetMetrics(): void {
  metrics.activeConnections = 0
  metrics.activeGladiaBridges = 0
  metrics.totalMessagesReceived = 0
  metrics.totalMessagesSent = 0
  metrics.totalErrors = 0
  metrics.lastError = undefined
}


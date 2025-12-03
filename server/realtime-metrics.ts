/**
 * Realtime Core Metrics
 * 
 * Простой сборщик метрик latency и counters для realtime-пайплайна.
 * Минимальный overhead, in-memory хранение.
 */

type LatencyBucket = {
  count: number
  sum: number
  min: number
  max: number
}

const latencyStore: Record<string, LatencyBucket> = {}
const countersStore: Record<string, number> = {}

/**
 * Записывает метрику latency
 */
export function recordLatency(name: string, valueMs: number): void {
  if (!Number.isFinite(valueMs) || valueMs < 0) {
    return
  }

  if (!latencyStore[name]) {
    latencyStore[name] = {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    }
  }

  const bucket = latencyStore[name]
  bucket.count += 1
  bucket.sum += valueMs
  bucket.min = Math.min(bucket.min, valueMs)
  bucket.max = Math.max(bucket.max, valueMs)

  // Периодическое логирование для отладки (каждые 200 записей)
  if (bucket.count % 200 === 0) {
    const avg = bucket.sum / bucket.count
    console.log(`[METRICS] ${name}`, {
      count: bucket.count,
      avgMs: Math.round(avg),
      minMs: Math.round(bucket.min),
      maxMs: Math.round(bucket.max),
    })
  }
}

/**
 * Записывает счетчик (increment)
 */
export function recordCounter(name: string, delta: number = 1): void {
  if (!Number.isFinite(delta)) {
    return
  }
  
  countersStore[name] = (countersStore[name] || 0) + delta
}

/**
 * Возвращает снимок всех метрик
 */
export function getLatencySnapshot(): Record<string, any> {
  const snapshot: Record<string, any> = {}
  
  for (const [name, bucket] of Object.entries(latencyStore)) {
    if (bucket.count === 0) continue
    
    snapshot[name] = {
      count: bucket.count,
      avgMs: bucket.sum / bucket.count,
      minMs: bucket.min === Number.POSITIVE_INFINITY ? 0 : bucket.min,
      maxMs: bucket.max === Number.NEGATIVE_INFINITY ? 0 : bucket.max,
    }
  }
  
  return snapshot
}

/**
 * Возвращает снимок всех счетчиков
 */
export function getCountersSnapshot(): Record<string, number> {
  return { ...countersStore }
}

/**
 * Сбрасывает все метрики (для тестирования)
 */
export function resetMetrics(): void {
  for (const key of Object.keys(latencyStore)) {
    delete latencyStore[key]
  }
  for (const key of Object.keys(countersStore)) {
    delete countersStore[key]
  }
}


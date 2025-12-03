// ws/server/audio-validator.ts
// Валидация аудио чанков для защиты от DoS атак

/**
 * Конфигурация валидации аудио.
 */
interface AudioValidationConfig {
  /** Максимальный размер чанка в байтах (по умолчанию 32KB для PCM16 16kHz) */
  maxChunkSizeBytes: number
  /** Минимальный размер чанка в байтах (защита от мусорных данных) */
  minChunkSizeBytes: number
  /** Максимальная частота чанков в секунду (защита от флуда) */
  maxChunksPerSecond: number
}

const DEFAULT_CONFIG: AudioValidationConfig = {
  maxChunkSizeBytes: 32 * 1024, // 32KB (примерно 1 секунда PCM16 при 16kHz)
  minChunkSizeBytes: 1, // Минимальный размер (обычно чанки 1-10KB)
  maxChunksPerSecond: 100, // Максимум 100 чанков в секунду (при 16kHz это ~1.6 секунды аудио)
}

/**
 * Трекинг частоты чанков по клиенту (для rate limiting).
 */
interface ChunkTracker {
  timestamps: number[]
  lastCleanup: number
}

const chunkTrackers = new Map<string, ChunkTracker>()

/**
 * Очищает старые записи из трекеров.
 */
function cleanupTrackers() {
  const now = Date.now()
  const windowMs = 1000 // 1 секунда

  for (const [clientId, tracker] of chunkTrackers.entries()) {
    // Удаляем записи старше 1 секунды
    tracker.timestamps = tracker.timestamps.filter((ts) => now - ts < windowMs)

    // Если нет активных записей и прошло больше 5 секунд с последней очистки - удаляем трекер
    if (tracker.timestamps.length === 0 && now - tracker.lastCleanup > 5000) {
      chunkTrackers.delete(clientId)
    } else {
      tracker.lastCleanup = now
    }
  }
}

// Запускаем очистку каждые 5 секунд
setInterval(cleanupTrackers, 5000)

/**
 * Валидирует аудио чанк.
 * 
 * @param chunkData Аудио данные (Buffer или ArrayBuffer)
 * @param clientId Уникальный идентификатор клиента (для rate limiting)
 * @param config Конфигурация валидации
 * @returns { valid: boolean, reason?: string }
 */
export function validateAudioChunk(
  chunkData: Buffer | ArrayBuffer,
  clientId: string,
  config: AudioValidationConfig = DEFAULT_CONFIG
): { valid: boolean; reason?: string } {
  const size = chunkData instanceof ArrayBuffer 
    ? chunkData.byteLength 
    : (chunkData as Buffer).length

  // Проверка размера чанка
  if (size > config.maxChunkSizeBytes) {
    return {
      valid: false,
      reason: `Chunk size ${size} exceeds maximum ${config.maxChunkSizeBytes} bytes`,
    }
  }

  if (size < config.minChunkSizeBytes) {
    return {
      valid: false,
      reason: `Chunk size ${size} is below minimum ${config.minChunkSizeBytes} bytes`,
    }
  }

  // Проверка частоты чанков (rate limiting)
  const now = Date.now()
  let tracker = chunkTrackers.get(clientId)

  if (!tracker) {
    tracker = {
      timestamps: [],
      lastCleanup: now,
    }
    chunkTrackers.set(clientId, tracker)
  }

  // Удаляем записи старше 1 секунды
  tracker.timestamps = tracker.timestamps.filter((ts) => now - ts < 1000)

  // Проверяем лимит
  if (tracker.timestamps.length >= config.maxChunksPerSecond) {
    return {
      valid: false,
      reason: `Rate limit exceeded: ${tracker.timestamps.length} chunks in the last second (max: ${config.maxChunksPerSecond})`,
    }
  }

  // Добавляем текущий чанк
  tracker.timestamps.push(now)

  return { valid: true }
}

/**
 * Очищает трекер для клиента (при отключении).
 */
export function cleanupClientTracker(clientId: string): void {
  chunkTrackers.delete(clientId)
}

/**
 * Очищает все трекеры (для тестов).
 */
export function clearAllTrackers(): void {
  chunkTrackers.clear()
}


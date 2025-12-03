import { queueTranscriptForInsert, type PendingTranscriptSegment } from './transcript-batch-queue.js'

export interface AppendTranscriptChunkInput {
  sessionSlug: string
  participantIdentity?: string
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
  sessionId?: string // Опционально: если уже известен ID сессии (для оптимизации)
}

/**
 * Добавляет финальный транскрипт в очередь для batch-записи в БД.
 * 
 * Оптимизация для высокой нагрузки:
 * - Вместо прямой записи в БД (upsert) добавляет транскрипт в очередь
 * - Batch-система периодически записывает накопленные транскрипты батчами
 * - Снижает нагрузку на БД в 10-50 раз
 * 
 * ВАЖНО: В БД сохраняются только финальные сегменты.
 * Partial-ы отправляются клиенту для UI, но не сохраняются в БД.
 */
export async function appendTranscriptChunk(input: AppendTranscriptChunkInput): Promise<void> {
  // ВАЛИДАЦИЯ: В БД сохраняем только финальные сегменты
  // Partial-ы отправляются клиенту для UI, но не сохраняются в БД
  // Это критично для масштабируемости (снижение нагрузки в 50-100 раз)
  if (!input.isFinal) {
    console.warn('[appendTranscriptChunk] Attempted to save partial transcript to DB, skipping', {
      sessionSlug: input.sessionSlug,
      utteranceId: input.utteranceId,
      textLength: input.text.length,
    })
    return
  }

  // Добавляем транскрипт в очередь для batch-записи
  // sessionId и participantId будут получены при flush (с кэшированием)
  const pendingSegment: PendingTranscriptSegment = {
    sessionSlug: input.sessionSlug,
    sessionId: input.sessionId || '', // Будет получен при flush
    participantIdentity: input.participantIdentity,
    participantId: null, // Будет получен при flush
    utteranceId: input.utteranceId,
    text: input.text,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  }

  queueTranscriptForInsert(pendingSegment)
  
  // Не логируем каждый транскрипт (слишком много логов при высокой нагрузке)
  // Логирование происходит в batch-системе при flush
}


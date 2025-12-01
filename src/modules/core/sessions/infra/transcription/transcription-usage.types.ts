/**
 * Типы для учёта использования транскрипции
 */

export interface TranscriptionUsage {
  id: string
  videoSessionId: string
  participantId: string | null
  userId: string | null
  startedAt: Date
  endedAt: Date | null
  durationSeconds: number
  durationMinutes: number
  audioChunksSent: number
  transcriptsReceived: number
  finalTranscripts: number
  partialTranscripts: number
  costPerMinute: number
  totalCost: number
  errorsCount: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateTranscriptionUsageInput {
  videoSessionId: string
  participantId?: string | null
  userId?: string | null
  startedAt: Date
  endedAt?: Date | null
  durationSeconds: number
  durationMinutes: number
  audioChunksSent?: number
  transcriptsReceived?: number
  finalTranscripts?: number
  partialTranscripts?: number
  costPerMinute?: number // По умолчанию берётся из конфига
  errorsCount?: number
}


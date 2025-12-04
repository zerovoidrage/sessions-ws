// src/types/server-transcription-message.ts
/**
 * Типы сообщений от WebSocket сервера транскрипции.
 */

/**
 * Initial handshake message от сервера при успешном подключении.
 */
export interface ConnectedMessage {
  type: 'connected'
  sessionSlug?: string
  userId?: string
  message?: string
  ts?: number
}

/**
 * Основной тип сообщения с транскриптом (старый формат для обратной совместимости).
 */
export interface TranscriptMessage {
  type: 'transcript' | 'transcription' // Поддерживаем оба варианта для обратной совместимости
  text: string
  isFinal: boolean
  is_final?: boolean // Альтернативное имя для обратной совместимости
  utteranceId?: string
  utterance_id?: string // Альтернативное имя для обратной совместимости
  speakerId?: string
  speaker_id?: string // Альтернативное имя для обратной совместимости
  ts?: number
  segments?: any
}

/**
 * Частичный транскрипт (interim/partial) - новый формат.
 */
export interface TranscriptPartialMessage {
  type: 'transcript_partial'
  text: string
  isFinal?: false // Всегда false для partial
  is_final?: false // Альтернативное имя для обратной совместимости
  utteranceId?: string
  utterance_id?: string // Альтернативное имя для обратной совместимости
  speakerId?: string
  speaker_id?: string // Альтернативное имя для обратной совместимости
  speaker?: string
  ts?: number
  segments?: any
}

/**
 * Финальный транскрипт - новый формат.
 */
export interface TranscriptFinalMessage {
  type: 'transcript_final'
  text: string
  isFinal?: true // Всегда true для final
  is_final?: true // Альтернативное имя для обратной совместимости
  utteranceId?: string
  utterance_id?: string // Альтернативное имя для обратной совместимости
  speakerId?: string
  speaker_id?: string // Альтернативное имя для обратной совместимости
  speaker?: string
  ts?: number
  segments?: any
}

/**
 * Сообщение об ошибке от сервера.
 */
export interface ErrorMessage {
  type: 'error'
  error: string
  message?: string // Альтернативное имя
  code?: string
}

/**
 * Сообщение о статусе STT pipeline.
 */
export interface SttStatusMessage {
  type: 'stt_status'
  status: 'ready' | 'connecting' | 'stopped'
  sessionSlug?: string
  timestamp?: number
  ts?: number
}

/**
 * Объединенный тип всех возможных сообщений от сервера.
 */
export type ServerTranscriptionMessage =
  | ConnectedMessage
  | TranscriptMessage
  | TranscriptPartialMessage
  | TranscriptFinalMessage
  | ErrorMessage
  | SttStatusMessage
  | (Record<string, any> & { type?: string }) // Fallback для неизвестных форматов



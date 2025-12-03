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
 * Основной тип сообщения с транскриптом.
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
 * Сообщение об ошибке от сервера.
 */
export interface ErrorMessage {
  type: 'error'
  error: string
  message?: string // Альтернативное имя
  code?: string
}

/**
 * Объединенный тип всех возможных сообщений от сервера.
 */
export type ServerTranscriptionMessage =
  | ConnectedMessage
  | TranscriptMessage
  | ErrorMessage
  | (Record<string, any> & { type?: string }) // Fallback для неизвестных форматов


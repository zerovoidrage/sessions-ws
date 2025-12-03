// ws-server/server/types.ts
/**
 * Типы для WebSocket сервера транскрипции.
 */

import type { WebSocket } from 'ws'

/**
 * Метаданные подключенного WebSocket клиента.
 */
export interface WsClientMeta {
  ws: WebSocket
  sessionSlug: string
  userId?: string
  connectedAt: number
}

/**
 * Типы сообщений от WebSocket сервера транскрипции.
 * Соответствует типу ServerTranscriptionMessage на клиенте.
 */
export type ServerTranscriptionMessage =
  | {
      type: 'connected'
      sessionSlug?: string
      userId?: string
      message?: string
      ts?: number
    }
  | {
      type: 'transcript' | 'transcription'
      sessionSlug?: string
      userId?: string
      utteranceId?: string
      text: string
      isFinal: boolean
      speaker?: string
      speakerId?: string
      ts?: number
      segments?: any
    }
  | {
      type: 'error'
      code?: string
      message: string
      error?: string // Альтернативное имя для обратной совместимости
      sessionSlug?: string
      userId?: string
      ts?: number
    }
  | (Record<string, any> & { type?: string }) // Fallback для неизвестных форматов

/**
 * Тип для тела запроса на broadcast транскриптов.
 */
export interface BroadcastTranscriptBody {
  sessionSlug: string
  userId?: string
  utteranceId: string
  text: string
  isFinal: boolean
  speaker?: string
  speakerId?: string
  ts?: number
}


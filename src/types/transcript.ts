// src/types/transcript.ts
export interface TranscriptMessage {
  id: string // Уникальный ID бабла в UI
  roomSlug: string
  speakerId: string
  speakerName: string
  text: string
  isFinal: boolean
  timestamp: number // Date.now()
  utteranceId?: string | null // ID сегмента от Gladia для правильной группировки
}


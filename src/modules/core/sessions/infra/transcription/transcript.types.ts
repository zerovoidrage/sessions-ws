export interface TranscriptSegment {
  id: string
  sessionId: string
  participantId?: string | null
  utteranceId: string // Gladia data.id
  text: string
  language?: string | null
  isFinal: boolean
  startedAt: Date
  endedAt?: Date | null
  createdAt: Date
}

export interface AppendTranscriptChunkInput {
  sessionSlug: string
  participantIdentity?: string
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
}

export interface ListTranscriptsBySessionInput {
  sessionSlug: string
}




// Статус звонка (статус сессии)
export type SessionCallStatus = 'CREATED' | 'LIVE' | 'ENDED' | 'EXPIRED'

// Для обратной совместимости:
export type SessionStatus = SessionCallStatus

// Причина завершения сессии
export type SessionEndReason =
  | 'ADMIN_ENDED'        // владелец/админ нажал End session
  | 'AUTO_EMPTY_ROOM'    // все вышли, авто-завершение по таймеру
  | 'EXPIRED_NO_JOIN'    // никто не зашёл, сессия протухла

export type ParticipantRole = 'HOST' | 'GUEST'

export interface Session {
  id: string
  slug: string
  title?: string | null
  createdByUserId?: string | null
  spaceId: string
  status: SessionStatus
  createdAt: Date
  startedAt?: Date | null
  endedAt?: Date | null
  lastActivityAt?: Date | null
  // Причина завершения сессии
  endReason?: SessionEndReason | null
  // ID пользователя, который завершил сессию
  endedByUserId?: string | null
  // Длительность сессии в секундах (рассчитывается при завершении)
  durationSeconds?: number | null
  // Raw transcript storage in Vercel Blob
  rawTranscriptBlobUrl?: string | null
  rawTranscriptSizeBytes?: number | null
  rawTranscriptReadyAt?: Date | null
  // AI metadata
  aiTitle?: string | null
  aiCurrentTopic?: string | null
  aiTopicsJson?: unknown | null
  aiUpdatedAt?: Date | null
}

export interface CreateSessionInput {
  title?: string
  spaceId: string
  createdByUserId?: string
}

export interface GetSessionBySlugInput {
  slug: string
}

export interface ListSessionsBySpaceInput {
  spaceId: string
  userId: string
}

export type AnalysisStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'

export interface SessionAnalysis {
  id: string
  sessionId: string
  status: AnalysisStatus
  createdAt: Date
  updatedAt: Date
  summary?: string | null
  tasksJson?: unknown | null
  risksJson?: unknown | null
}


export type SessionStatus = 'CREATED' | 'LIVE' | 'ENDED' | 'EXPIRED'

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


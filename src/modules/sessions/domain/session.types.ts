export type SessionStatus = 'ACTIVE' | 'ENDED'

export type ParticipantRole = 'HOST' | 'GUEST'

export interface Session {
  id: string
  slug: string
  title?: string | null
  createdByUserId?: string | null
  status: SessionStatus
  createdAt: Date
  endedAt?: Date | null
}

export interface CreateSessionInput {
  title?: string
  createdByUserId?: string
}

export interface GetSessionBySlugInput {
  slug: string
}



export type SessionStatus = 'ACTIVE' | 'ENDED'

export type ParticipantRole = 'HOST' | 'GUEST'

export interface Session {
  id: string
  slug: string
  title?: string | null
  createdByUserId?: string | null
  spaceId: string
  status: SessionStatus
  createdAt: Date
  endedAt?: Date | null
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



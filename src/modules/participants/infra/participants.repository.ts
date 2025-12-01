import { db } from '@/lib/db'

export interface UpsertParticipantInput {
  sessionId: string
  identity: string
  name?: string
  role?: 'HOST' | 'GUEST'
  userId?: string | null
}

export interface Participant {
  id: string
  sessionId: string
  userId?: string | null
  identity: string
  name?: string | null
  role: 'HOST' | 'GUEST'
  joinedAt: Date
  leftAt?: Date | null
}

export async function upsertParticipantByIdentity(input: UpsertParticipantInput): Promise<Participant> {
  const participant = await db.participant.upsert({
    where: {
      videoSessionId_identity: {
        videoSessionId: input.sessionId,
        identity: input.identity,
      },
    },
    create: {
      videoSessionId: input.sessionId,
      identity: input.identity,
      name: input.name,
      role: input.role || 'GUEST',
      userId: input.userId,
    },
    update: {
      name: input.name,
      leftAt: null, // Сбрасываем leftAt если участник вернулся
    },
  })

  return {
    id: participant.id,
    sessionId: participant.videoSessionId,
    userId: participant.userId,
    identity: participant.identity,
    name: participant.name,
    role: participant.role as 'HOST' | 'GUEST',
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
  }
}

export async function markParticipantLeft(sessionId: string, identity: string): Promise<void> {
  await db.participant.updateMany({
    where: {
      videoSessionId: sessionId,
      identity,
      leftAt: null,
    },
    data: {
      leftAt: new Date(),
    },
  })
}


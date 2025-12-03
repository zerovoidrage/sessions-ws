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

export interface ParticipantWithUser {
  id: string
  sessionId: string
  userId?: string | null
  identity: string
  name?: string | null
  role: 'HOST' | 'GUEST'
  joinedAt: Date
  leftAt?: Date | null
  user?: {
    id: string
    displayName?: string | null
    avatarUrl?: string | null
    noAvatarColor?: string | null
  } | null
}

export async function getParticipantWithUserByIdentity(
  sessionId: string,
  identity: string
): Promise<ParticipantWithUser | null> {
  const participant = await db.participant.findUnique({
    where: {
      videoSessionId_identity: {
        videoSessionId: sessionId,
        identity,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          noAvatarColor: true,
        },
      },
    },
  })

  if (!participant) {
    return null
  }

  return {
    id: participant.id,
    sessionId: participant.videoSessionId,
    userId: participant.userId,
    identity: participant.identity,
    name: participant.name,
    role: participant.role as 'HOST' | 'GUEST',
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
    user: participant.user
      ? {
          id: participant.user.id,
          displayName: participant.user.displayName,
          avatarUrl: participant.user.avatarUrl,
          noAvatarColor: participant.user.noAvatarColor,
        }
      : null,
  }
}

/**
 * Получить всех активных участников сессии (leftAt === null)
 */
export async function getActiveParticipantsBySessionId(
  sessionId: string
): Promise<Participant[]> {
  const participants = await db.participant.findMany({
    where: {
      videoSessionId: sessionId,
      leftAt: null, // Только активные участники
    },
    orderBy: {
      joinedAt: 'asc', // Сортируем по времени подключения (самый ранний первый)
    },
  })

  return participants.map((p) => ({
    id: p.id,
    sessionId: p.videoSessionId,
    userId: p.userId,
    identity: p.identity,
    name: p.name,
    role: p.role as 'HOST' | 'GUEST',
    joinedAt: p.joinedAt,
    leftAt: p.leftAt,
  }))
}


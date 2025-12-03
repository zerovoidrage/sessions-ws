import { db } from '@/lib/db'
import type { Session, CreateSessionInput, GetSessionBySlugInput } from '../../domain/session.types'

export async function createSession(input: CreateSessionInput & { slug: string }): Promise<Session> {
  const session = await db.videoSession.create({
    data: {
      slug: input.slug,
      title: input.title,
      createdByUserId: input.createdByUserId,
      spaceId: input.spaceId,
      status: 'CREATED',
      startedAt: null,
      endedAt: null,
      lastActivityAt: null,
    },
  })

  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    createdByUserId: session.createdByUserId,
    spaceId: session.spaceId,
    status: session.status as Session['status'],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActivityAt: session.lastActivityAt,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
  }
}

export async function getSessionBySlug(input: GetSessionBySlugInput): Promise<Session | null> {
  const session = await db.videoSession.findUnique({
    where: { slug: input.slug },
  })

  if (!session) return null

  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    createdByUserId: session.createdByUserId,
    spaceId: session.spaceId,
    status: session.status as Session['status'],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActivityAt: session.lastActivityAt,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
  }
}

export async function listSessionsBySpace(spaceId: string): Promise<Session[]> {
  const sessions = await db.videoSession.findMany({
    where: { 
      spaceId,
      status: {
        not: 'EXPIRED', // Исключаем протухшие сессии из основного списка
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return sessions.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    createdByUserId: s.createdByUserId,
    spaceId: s.spaceId,
    status: s.status as Session['status'],
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastActivityAt: s.lastActivityAt,
  }))
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  const session = await db.videoSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) return null

  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    createdByUserId: session.createdByUserId,
    spaceId: session.spaceId,
    status: session.status as Session['status'],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActivityAt: session.lastActivityAt,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
  }
}

export async function endSession(sessionId: string): Promise<void> {
  await db.videoSession.update({
    where: { id: sessionId },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
    },
  })
}

export async function updateSessionStatus(
  sessionId: string,
  status: Session['status'],
  additionalData?: {
    startedAt?: Date | null
    endedAt?: Date | null
    lastActivityAt?: Date | null
  }
): Promise<Session> {
  const session = await db.videoSession.update({
    where: { id: sessionId },
    data: {
      status,
      ...(additionalData?.startedAt !== undefined && { startedAt: additionalData.startedAt }),
      ...(additionalData?.endedAt !== undefined && { endedAt: additionalData.endedAt }),
      ...(additionalData?.lastActivityAt !== undefined && { lastActivityAt: additionalData.lastActivityAt }),
    },
  })

  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    createdByUserId: session.createdByUserId,
    spaceId: session.spaceId,
    status: session.status as Session['status'],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActivityAt: session.lastActivityAt,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
  }
}

export async function updateSessionActivity(sessionId: string, lastActivityAt: Date): Promise<void> {
  await db.videoSession.update({
    where: { id: sessionId },
    data: {
      lastActivityAt,
    },
  })
}

export async function findInactiveLiveSessions(inactiveMinutes: number): Promise<Session[]> {
  const cutoffTime = new Date(Date.now() - inactiveMinutes * 60 * 1000)
  
  const sessions = await db.videoSession.findMany({
    where: {
      status: 'LIVE',
      lastActivityAt: {
        not: null,
        lt: cutoffTime,
      },
    },
  })

  return sessions.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    createdByUserId: s.createdByUserId,
    spaceId: s.spaceId,
    status: s.status as Session['status'],
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastActivityAt: s.lastActivityAt,
  }))
}

export async function findOldCreatedSessions(expireHours: number): Promise<Session[]> {
  const cutoffTime = new Date(Date.now() - expireHours * 60 * 60 * 1000)
  
  const sessions = await db.videoSession.findMany({
    where: {
      status: 'CREATED',
      createdAt: {
        lt: cutoffTime,
      },
    },
  })

  return sessions.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    createdByUserId: s.createdByUserId,
    spaceId: s.spaceId,
    status: s.status as Session['status'],
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastActivityAt: s.lastActivityAt,
  }))
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  // Удаляем все связанные записи перед удалением сессии
  await db.$transaction(async (tx) => {
    // Удаляем все транскрипты сессии
    await tx.transcriptSegment.deleteMany({
      where: { videoSessionId: sessionId },
    })
    
    // Удаляем всех участников сессии
    await tx.participant.deleteMany({
      where: { videoSessionId: sessionId },
    })
    
    // Теперь можно безопасно удалить сессию
    await tx.videoSession.delete({
      where: { id: sessionId },
    })
  })
}

export async function deleteAllSessions(): Promise<void> {
  // Удаляем все записи использования транскрипции (если таблица существует)
  // Делаем это ДО транзакции, чтобы ошибка не прервала основную транзакцию
  try {
    await db.transcriptionUsage.deleteMany({})
  } catch (error: any) {
    // Игнорируем ошибку, если таблица не существует (P2021 - table does not exist)
    if (error?.code !== 'P2021') {
      console.warn('[deleteAllSessions] Error deleting transcriptionUsage:', error)
    } else {
      console.warn('[deleteAllSessions] TranscriptionUsage table does not exist, skipping deletion')
    }
  }
  
  // Удаляем все связанные записи перед удалением всех сессий
  await db.$transaction(async (tx) => {
    // Удаляем все транскрипты всех сессий
    await tx.transcriptSegment.deleteMany({})
    
    // Удаляем всех участников всех сессий
    await tx.participant.deleteMany({})
    
    // Теперь можно безопасно удалить все сессии
    await tx.videoSession.deleteMany({})
  })
}


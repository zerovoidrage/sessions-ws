import { db } from '@/lib/db'
import type { Session, CreateSessionInput, GetSessionBySlugInput } from '../../domain/session.types'

export async function createSession(input: CreateSessionInput & { slug: string }): Promise<Session> {
  const session = await db.videoSession.create({
    data: {
      slug: input.slug,
      title: input.title,
      createdByUserId: input.createdByUserId,
      spaceId: input.spaceId,
      status: 'ACTIVE',
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
    endedAt: session.endedAt,
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
    endedAt: session.endedAt,
  }
}

export async function listSessionsBySpace(spaceId: string): Promise<Session[]> {
  const sessions = await db.videoSession.findMany({
    where: { spaceId },
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
    endedAt: s.endedAt,
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
    endedAt: session.endedAt,
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
  // Удаляем все связанные записи перед удалением всех сессий
  await db.$transaction(async (tx) => {
    // Удаляем все транскрипты всех сессий
    await tx.transcriptSegment.deleteMany({})
    
    // Удаляем всех участников всех сессий
    await tx.participant.deleteMany({})
    
    // Удаляем все записи использования транскрипции
    await tx.transcriptionUsage.deleteMany({})
    
    // Теперь можно безопасно удалить все сессии
    await tx.videoSession.deleteMany({})
  })
}


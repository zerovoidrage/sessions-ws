import { db } from '@/lib/db'
import type { Session, CreateSessionInput, GetSessionBySlugInput, SessionEndReason } from '../../domain/session.types'

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
    endReason: session.endReason as SessionEndReason | null,
    endedByUserId: session.endedByUserId,
    durationSeconds: session.durationSeconds,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    aiTopicsJson: session.aiTopicsJson,
    aiUpdatedAt: session.aiUpdatedAt,
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
    endReason: session.endReason as SessionEndReason | null,
    endedByUserId: session.endedByUserId,
    durationSeconds: session.durationSeconds,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    aiTopicsJson: session.aiTopicsJson,
    aiUpdatedAt: session.aiUpdatedAt,
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
    endReason: s.endReason as SessionEndReason | null,
    endedByUserId: s.endedByUserId,
    durationSeconds: s.durationSeconds,
    rawTranscriptBlobUrl: s.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: s.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: s.rawTranscriptReadyAt,
    aiTitle: s.aiTitle,
    aiCurrentTopic: s.aiCurrentTopic,
    aiTopicsJson: s.aiTopicsJson,
    aiUpdatedAt: s.aiUpdatedAt,
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
    endReason: session.endReason as SessionEndReason | null,
    endedByUserId: session.endedByUserId,
    durationSeconds: session.durationSeconds,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    aiTopicsJson: session.aiTopicsJson,
    aiUpdatedAt: session.aiUpdatedAt,
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
    endReason?: SessionEndReason | null
    endedByUserId?: string | null
    durationSeconds?: number | null
  }
): Promise<Session> {
  const session = await db.videoSession.update({
    where: { id: sessionId },
    data: {
      status,
      ...(additionalData?.startedAt !== undefined && { startedAt: additionalData.startedAt }),
      ...(additionalData?.endedAt !== undefined && { endedAt: additionalData.endedAt }),
      ...(additionalData?.lastActivityAt !== undefined && { lastActivityAt: additionalData.lastActivityAt }),
      ...(additionalData?.endReason !== undefined && { endReason: additionalData.endReason }),
      ...(additionalData?.endedByUserId !== undefined && { endedByUserId: additionalData.endedByUserId }),
      ...(additionalData?.durationSeconds !== undefined && { durationSeconds: additionalData.durationSeconds }),
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
    endReason: session.endReason as SessionEndReason | null,
    endedByUserId: session.endedByUserId,
    durationSeconds: session.durationSeconds,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    aiTopicsJson: session.aiTopicsJson,
    aiUpdatedAt: session.aiUpdatedAt,
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

/**
 * Обновляет AI-метаданные сессии
 */
export async function updateSessionAiMetadata(params: {
  sessionId: string
  aiTitle?: string | null
  aiCurrentTopic?: string | null
  aiTopicsJson?: unknown | null
}): Promise<Session> {
  const { sessionId, aiTitle, aiCurrentTopic, aiTopicsJson } = params

  console.log('[updateSessionAiMetadata] Updating AI metadata:', {
    sessionId,
    aiTitle,
    aiCurrentTopic,
    hasTopicsJson: !!aiTopicsJson,
    topicsJsonType: Array.isArray(aiTopicsJson) ? `array[${(aiTopicsJson as any[]).length}]` : typeof aiTopicsJson,
  })

  const session = await db.videoSession.update({
    where: { id: sessionId },
    data: {
      aiTitle: aiTitle ?? undefined,
      aiCurrentTopic: aiCurrentTopic ?? undefined,
      aiTopicsJson: aiTopicsJson ?? undefined,
      aiUpdatedAt: new Date(),
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
    endReason: session.endReason as SessionEndReason | null,
    endedByUserId: session.endedByUserId,
    durationSeconds: session.durationSeconds,
    rawTranscriptBlobUrl: session.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: session.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: session.rawTranscriptReadyAt,
    aiTitle: session.aiTitle,
    aiCurrentTopic: session.aiCurrentTopic,
    aiTopicsJson: session.aiTopicsJson,
    aiUpdatedAt: session.aiUpdatedAt,
  }
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
    endReason: s.endReason as SessionEndReason | null,
    endedByUserId: s.endedByUserId,
    durationSeconds: s.durationSeconds,
    rawTranscriptBlobUrl: s.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: s.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: s.rawTranscriptReadyAt,
    aiTitle: s.aiTitle,
    aiCurrentTopic: s.aiCurrentTopic,
    aiTopicsJson: s.aiTopicsJson,
    aiUpdatedAt: s.aiUpdatedAt,
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
    endReason: s.endReason as SessionEndReason | null,
    endedByUserId: s.endedByUserId,
    durationSeconds: s.durationSeconds,
    rawTranscriptBlobUrl: s.rawTranscriptBlobUrl,
    rawTranscriptSizeBytes: s.rawTranscriptSizeBytes,
    rawTranscriptReadyAt: s.rawTranscriptReadyAt,
    aiTitle: s.aiTitle,
    aiCurrentTopic: s.aiCurrentTopic,
    aiTopicsJson: s.aiTopicsJson,
    aiUpdatedAt: s.aiUpdatedAt,
  }))
}

/**
 * Завершение сессии администратором (ручное завершение)
 */
export async function endSessionByAdmin(params: {
  sessionId: string
  endedByUserId: string
}): Promise<Session> {
  const session = await db.videoSession.findUnique({
    where: { id: params.sessionId },
  })

  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  const now = new Date()
  const endedAt = session.endedAt || now
  const durationSeconds = session.startedAt
    ? Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000)
    : null

  return updateSessionStatus(params.sessionId, 'ENDED', {
    endReason: 'ADMIN_ENDED',
    endedByUserId: params.endedByUserId,
    endedAt,
    lastActivityAt: now,
    durationSeconds,
  })
}

/**
 * Автоматическое завершение неактивной сессии
 */
export async function autoEndSession(params: {
  sessionId: string
}): Promise<Session> {
  const session = await db.videoSession.findUnique({
    where: { id: params.sessionId },
  })

  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  if (session.status !== 'LIVE') {
    // Идемпотентность: если уже не LIVE, возвращаем текущее состояние
    return getSessionById(params.sessionId) as Promise<Session>
  }

  const now = new Date()
  const endedAt = session.endedAt || now
  const durationSeconds = session.startedAt
    ? Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000)
    : null

  return updateSessionStatus(params.sessionId, 'ENDED', {
    endReason: 'AUTO_EMPTY_ROOM',
    endedAt,
    lastActivityAt: now,
    durationSeconds,
  })
}

/**
 * Истечение срока действия неактивированной сессии
 */
export async function expireCreatedSession(sessionId: string): Promise<Session> {
  const session = await db.videoSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  if (session.status !== 'CREATED') {
    // Идемпотентность: если уже не CREATED, возвращаем текущее состояние
    return getSessionById(sessionId) as Promise<Session>
  }

  return updateSessionStatus(sessionId, 'EXPIRED', {
    endReason: 'EXPIRED_NO_JOIN',
    endedAt: null,
    durationSeconds: null,
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


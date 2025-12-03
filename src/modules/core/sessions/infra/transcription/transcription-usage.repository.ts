import { db } from '@/lib/db'
import type { TranscriptionUsage, CreateTranscriptionUsageInput } from './transcription-usage.types'

/**
 * Репозиторий для работы с учётом использования транскрипции
 */

export async function createTranscriptionUsage(
  input: CreateTranscriptionUsageInput
): Promise<TranscriptionUsage> {
  const { durationMinutes, costPerMinute = 0.01 } = input
  const totalCost = durationMinutes * costPerMinute

  const usage = await db.transcriptionUsage.create({
    data: {
      videoSessionId: input.videoSessionId,
      participantId: input.participantId || null,
      userId: input.userId || null,
      startedAt: input.startedAt,
      endedAt: input.endedAt || null,
      durationSeconds: input.durationSeconds,
      durationMinutes,
      audioChunksSent: input.audioChunksSent || 0,
      transcriptsReceived: input.transcriptsReceived || 0,
      finalTranscripts: input.finalTranscripts || 0,
      partialTranscripts: input.partialTranscripts || 0,
      costPerMinute,
      totalCost,
      errorsCount: input.errorsCount || 0,
    },
  })

  return {
    id: usage.id,
    videoSessionId: usage.videoSessionId,
    participantId: usage.participantId,
    userId: usage.userId,
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    durationSeconds: usage.durationSeconds,
    durationMinutes: usage.durationMinutes,
    audioChunksSent: usage.audioChunksSent,
    transcriptsReceived: usage.transcriptsReceived,
    finalTranscripts: usage.finalTranscripts,
    partialTranscripts: usage.partialTranscripts,
    costPerMinute: usage.costPerMinute,
    totalCost: usage.totalCost,
    errorsCount: usage.errorsCount,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
  }
}

/**
 * Обновляет запись использования транскрипции (например, при завершении сессии)
 */
export async function updateTranscriptionUsage(
  id: string,
  input: Partial<CreateTranscriptionUsageInput>
): Promise<TranscriptionUsage> {
  const updateData: any = {}
  
  if (input.endedAt !== undefined) {
    updateData.endedAt = input.endedAt
  }
  
  if (input.durationSeconds !== undefined) {
    updateData.durationSeconds = input.durationSeconds
  }
  
  if (input.durationMinutes !== undefined) {
    updateData.durationMinutes = input.durationMinutes
    // Пересчитываем стоимость
    const existing = await db.transcriptionUsage.findUnique({ where: { id } })
    if (existing) {
      updateData.totalCost = input.durationMinutes * existing.costPerMinute
    }
  }
  
  if (input.audioChunksSent !== undefined) {
    updateData.audioChunksSent = input.audioChunksSent
  }
  
  if (input.transcriptsReceived !== undefined) {
    updateData.transcriptsReceived = input.transcriptsReceived
  }
  
  if (input.finalTranscripts !== undefined) {
    updateData.finalTranscripts = input.finalTranscripts
  }
  
  if (input.partialTranscripts !== undefined) {
    updateData.partialTranscripts = input.partialTranscripts
  }
  
  if (input.errorsCount !== undefined) {
    updateData.errorsCount = input.errorsCount
  }

  const usage = await db.transcriptionUsage.update({
    where: { id },
    data: updateData,
  })

  return {
    id: usage.id,
    videoSessionId: usage.videoSessionId,
    participantId: usage.participantId,
    userId: usage.userId,
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    durationSeconds: usage.durationSeconds,
    durationMinutes: usage.durationMinutes,
    audioChunksSent: usage.audioChunksSent,
    transcriptsReceived: usage.transcriptsReceived,
    finalTranscripts: usage.finalTranscripts,
    partialTranscripts: usage.partialTranscripts,
    costPerMinute: usage.costPerMinute,
    totalCost: usage.totalCost,
    errorsCount: usage.errorsCount,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
  }
}

/**
 * Получает статистику использования транскрипции для сессии
 */
export async function getTranscriptionUsageBySession(
  videoSessionId: string
): Promise<TranscriptionUsage[]> {
  const usages = await db.transcriptionUsage.findMany({
    where: { videoSessionId },
    orderBy: { createdAt: 'desc' },
  })

  return usages.map((usage) => ({
    id: usage.id,
    videoSessionId: usage.videoSessionId,
    participantId: usage.participantId,
    userId: usage.userId,
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    durationSeconds: usage.durationSeconds,
    durationMinutes: usage.durationMinutes,
    audioChunksSent: usage.audioChunksSent,
    transcriptsReceived: usage.transcriptsReceived,
    finalTranscripts: usage.finalTranscripts,
    partialTranscripts: usage.partialTranscripts,
    costPerMinute: usage.costPerMinute,
    totalCost: usage.totalCost,
    errorsCount: usage.errorsCount,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
  }))
}

/**
 * Получает статистику использования транскрипции для пользователя
 */
export async function getTranscriptionUsageByUser(
  userId: string,
  limit: number = 100
): Promise<TranscriptionUsage[]> {
  const usages = await db.transcriptionUsage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return usages.map((usage) => ({
    id: usage.id,
    videoSessionId: usage.videoSessionId,
    participantId: usage.participantId,
    userId: usage.userId,
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    durationSeconds: usage.durationSeconds,
    durationMinutes: usage.durationMinutes,
    audioChunksSent: usage.audioChunksSent,
    transcriptsReceived: usage.transcriptsReceived,
    finalTranscripts: usage.finalTranscripts,
    partialTranscripts: usage.partialTranscripts,
    costPerMinute: usage.costPerMinute,
    totalCost: usage.totalCost,
    errorsCount: usage.errorsCount,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
  }))
}

/**
 * Получает агрегированную статистику (общая стоимость, минуты) для пользователя
 */
export async function getTranscriptionStatsByUser(userId: string): Promise<{
  totalMinutes: number
  totalCost: number
  totalSessions: number
  averageDurationMinutes: number
}> {
  const stats = await db.transcriptionUsage.aggregate({
    where: { userId },
    _sum: {
      durationMinutes: true,
      totalCost: true,
    },
    _count: {
      id: true,
    },
    _avg: {
      durationMinutes: true,
    },
  })

  return {
    totalMinutes: stats._sum.durationMinutes || 0,
    totalCost: stats._sum.totalCost || 0,
    totalSessions: stats._count.id || 0,
    averageDurationMinutes: stats._avg.durationMinutes || 0,
  }
}


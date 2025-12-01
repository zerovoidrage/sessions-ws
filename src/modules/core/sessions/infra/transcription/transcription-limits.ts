/**
 * Функции для проверки ограничений по количеству активных транскрипций
 */

import { getTranscriptionUsageBySession } from './transcription-usage.repository'
import { getTranscriptionUsageByUser } from './transcription-usage.repository'
import { getTranscriptionFlags } from './transcription-flags'

/**
 * Проверяет, не превышен ли лимит активных транскрипций для сессии
 */
export async function checkSessionTranscriptionLimit(
  sessionId: string
): Promise<{ allowed: boolean; reason?: string; currentCount: number }> {
  const flags = getTranscriptionFlags()
  
  // Получаем все активные использования транскрипции для сессии (без endedAt)
  const usage = await getTranscriptionUsageBySession(sessionId)
  const activeUsage = usage.filter((u) => !u.endedAt)
  const currentCount = activeUsage.length

  if (currentCount >= flags.maxActiveTranscriptionsPerSession) {
    return {
      allowed: false,
      reason: `Maximum ${flags.maxActiveTranscriptionsPerSession} active transcriptions per session`,
      currentCount,
    }
  }

  return { allowed: true, currentCount }
}

/**
 * Проверяет, не превышен ли лимит активных транскрипций для пользователя
 */
export async function checkUserTranscriptionLimit(
  userId: string
): Promise<{ allowed: boolean; reason?: string; currentCount: number }> {
  const flags = getTranscriptionFlags()
  
  // Получаем все активные использования транскрипции для пользователя (без endedAt)
  const usage = await getTranscriptionUsageByUser(userId, 1000) // Получаем все для проверки
  const activeUsage = usage.filter((u) => !u.endedAt)
  const currentCount = activeUsage.length

  if (currentCount >= flags.maxActiveTranscriptionsPerUser) {
    return {
      allowed: false,
      reason: `Maximum ${flags.maxActiveTranscriptionsPerUser} active transcriptions per user`,
      currentCount,
    }
  }

  return { allowed: true, currentCount }
}

/**
 * Проверяет все ограничения перед запуском транскрипции
 */
export async function checkTranscriptionLimits(input: {
  sessionId: string
  userId?: string
}): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = []
  
  // Проверяем лимит для сессии
  const sessionCheck = await checkSessionTranscriptionLimit(input.sessionId)
  if (!sessionCheck.allowed && sessionCheck.reason) {
    reasons.push(sessionCheck.reason)
  }

  // Проверяем лимит для пользователя (если указан)
  if (input.userId) {
    const userCheck = await checkUserTranscriptionLimit(input.userId)
    if (!userCheck.allowed && userCheck.reason) {
      reasons.push(userCheck.reason)
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  }
}


/**
 * Feature flags для управления транскрипцией
 * Позволяет включать/выключать транскрипцию на разных уровнях
 */

export interface TranscriptionFlags {
  // Глобальный флаг (через env переменную)
  globalEnabled: boolean
  
  // Флаг для пользователя (можно хранить в БД в будущем)
  userEnabled: boolean
  
  // Флаг для сессии (можно хранить в БД VideoSession)
  sessionEnabled: boolean
  
  // Максимальное количество активных транскрипций на пользователя
  maxActiveTranscriptionsPerUser: number
  
  // Максимальное количество транскрипций на сессию
  maxActiveTranscriptionsPerSession: number
  
  // Максимальная длительность транскрипции в минутах (0 = без ограничений)
  maxTranscriptionMinutes: number
}

const DEFAULT_FLAGS: TranscriptionFlags = {
  globalEnabled: process.env.NEXT_PUBLIC_TRANSCRIPTION_ENABLED !== 'false',
  userEnabled: true,
  sessionEnabled: true,
  maxActiveTranscriptionsPerUser: 5, // Максимум 5 активных транскрипций на пользователя
  maxActiveTranscriptionsPerSession: 10, // Максимум 10 активных транскрипций на сессию
  maxTranscriptionMinutes: 0, // Без ограничений по умолчанию
}

/**
 * Получает feature flags для транскрипции
 * В будущем можно расширить для получения из БД или API
 */
export function getTranscriptionFlags(): TranscriptionFlags {
  // TODO: Получать из БД (настройки пользователя, сессии)
  // Пока возвращаем дефолтные значения
  return { ...DEFAULT_FLAGS }
}

/**
 * Проверяет, включена ли транскрипция глобально
 */
export function isTranscriptionGloballyEnabled(): boolean {
  const flags = getTranscriptionFlags()
  return flags.globalEnabled
}

/**
 * Проверяет, включена ли транскрипция для пользователя
 */
export function isTranscriptionEnabledForUser(userId?: string): boolean {
  const flags = getTranscriptionFlags()
  
  if (!flags.globalEnabled) {
    return false
  }
  
  if (!flags.userEnabled) {
    return false
  }
  
  // TODO: Проверка в БД, есть ли у пользователя доступ
  return true
}

/**
 * Проверяет, включена ли транскрипция для сессии
 */
export function isTranscriptionEnabledForSession(sessionSlug: string): boolean {
  const flags = getTranscriptionFlags()
  
  if (!flags.globalEnabled) {
    return false
  }
  
  if (!flags.sessionEnabled) {
    return false
  }
  
  // TODO: Проверка в БД, включена ли транскрипция для этой сессии
  return true
}

/**
 * Проверяет, можно ли запустить транскрипцию для пользователя
 * (проверка ограничений по количеству активных транскрипций)
 */
export async function canStartTranscriptionForUser(
  userId: string,
  currentActiveCount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const flags = getTranscriptionFlags()
  
  if (currentActiveCount >= flags.maxActiveTranscriptionsPerUser) {
    return {
      allowed: false,
      reason: `Maximum ${flags.maxActiveTranscriptionsPerUser} active transcriptions per user`,
    }
  }
  
  return { allowed: true }
}

/**
 * Проверяет, можно ли запустить транскрипцию для сессии
 */
export async function canStartTranscriptionForSession(
  sessionSlug: string,
  currentActiveCount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const flags = getTranscriptionFlags()
  
  if (currentActiveCount >= flags.maxActiveTranscriptionsPerSession) {
    return {
      allowed: false,
      reason: `Maximum ${flags.maxActiveTranscriptionsPerSession} active transcriptions per session`,
    }
  }
  
  return { allowed: true }
}


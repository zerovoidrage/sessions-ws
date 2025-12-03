/**
 * Active Speaker Tracker
 * Отслеживает активных спикеров в сессиях для маппинга транскриптов.
 */

// Хранилище активных спикеров по сессиям
const activeSpeakers = new Map<string, {
  identity: string
  name?: string
  timestamp: number
}>()

/**
 * Обновляет информацию об активном спикере для сессии.
 */
export async function updateActiveSpeaker(
  sessionSlug: string,
  participantIdentity: string,
  isActive: boolean = true,
  name?: string
): Promise<void> {
  if (!isActive) {
    // Удаляем из активных, если спикер перестал говорить
    const current = activeSpeakers.get(sessionSlug)
    if (current?.identity === participantIdentity) {
      activeSpeakers.delete(sessionSlug)
    }
    return
  }

  // Обновляем активного спикера
  activeSpeakers.set(sessionSlug, {
    identity: participantIdentity,
    name,
    timestamp: Date.now(),
  })
}

/**
 * Получает текущего активного спикера для сессии.
 */
export function getActiveSpeaker(sessionSlug: string): {
  identity: string
  name?: string
  timestamp: number
} | null {
  return activeSpeakers.get(sessionSlug) || null
}

/**
 * Очищает данные активного спикера для сессии.
 */
export function clearActiveSpeaker(sessionSlug: string): void {
  activeSpeakers.delete(sessionSlug)
}


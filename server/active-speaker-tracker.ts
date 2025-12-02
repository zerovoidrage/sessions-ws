/**
 * Отслеживание активных спикеров в реальном времени.
 * 
 * Клиенты отправляют active speaker events через WebSocket,
 * сервер отслеживает текущего активного спикера для каждой сессии.
 */

export interface ActiveSpeakerEvent {
  sessionSlug: string
  participantIdentity: string
  participantName?: string
  timestamp: number
}

// Хранилище текущих активных спикеров по сессиям
// sessionSlug -> { identity, name, timestamp }
const activeSpeakers = new Map<string, {
  identity: string
  name?: string
  timestamp: number
}>()

/**
 * Обновляет текущего активного спикера для сессии.
 */
export function updateActiveSpeaker(event: ActiveSpeakerEvent): void {
  const { sessionSlug, participantIdentity, participantName, timestamp } = event
  
  // Обновляем только если это более свежее событие
  const current = activeSpeakers.get(sessionSlug)
  if (!current || timestamp > current.timestamp) {
    activeSpeakers.set(sessionSlug, {
      identity: participantIdentity,
      name: participantName,
      timestamp,
    })
    
    console.log(`[ActiveSpeakerTracker] Updated active speaker for ${sessionSlug}: ${participantIdentity}`)
  }
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
 * Очищает активного спикера для сессии (при завершении сессии).
 */
export function clearActiveSpeaker(sessionSlug: string): void {
  activeSpeakers.delete(sessionSlug)
  console.log(`[ActiveSpeakerTracker] Cleared active speaker for ${sessionSlug}`)
}

/**
 * Очищает всех активных спикеров (при перезапуске сервера).
 */
export function clearAllActiveSpeakers(): void {
  activeSpeakers.clear()
  console.log(`[ActiveSpeakerTracker] Cleared all active speakers`)
}


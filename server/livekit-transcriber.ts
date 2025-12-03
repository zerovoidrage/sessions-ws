/**
 * Серверный транскрайбер для LiveKit комнат.
 * 
 * Подключается к LiveKit комнате как участник, подписывается на все аудио треки,
 * микширует их и отправляет в Gladia для транскрипции.
 * 
 * Транскрипты публикуются через LiveKit data channel для всех участников комнаты.
 */

// Импорты для серверной транскрипции через Egress API
// livekit-client не используется - это браузерный SDK, не работает в Node.js
import dotenv from 'dotenv'

dotenv.config()

// Конфигурация LiveKit для серверного окружения (используется только в Egress API)
// livekit-client больше не используется - используем только livekit-server-sdk

export interface StartServerTranscriptionOptions {
  sessionId: string
  sessionSlug: string // room name
}

export interface ServerTranscriber {
  stop(): Promise<void>
  isActive(): boolean
}

// Хранилище активных транскрайберов
const activeTranscribers = new Map<string, ServerTranscriber>()

/**
 * Запускает серверную транскрипцию для сессии.
 * 
 * Использует LiveKit Egress API для получения аудио потока.
 * 
 * Создаёт Egress сессию, которая:
 * 1. Получает аудио поток из LiveKit комнаты
 * 2. Отправляет его на наш WebSocket сервер
 * 3. Мы обрабатываем аудио и отправляем в Gladia
 * 4. Публикуем транскрипты через LiveKit data channel
 */
export async function startServerTranscription(
  options: StartServerTranscriptionOptions
): Promise<ServerTranscriber> {
  const { sessionId, sessionSlug } = options

  // Проверяем, не запущена ли уже транскрипция для этой сессии
  if (activeTranscribers.has(sessionId)) {
    console.warn(`[ServerTranscriber] Transcription already active for session ${sessionId}`)
    return activeTranscribers.get(sessionId)!
  }

  console.log(`[ServerTranscriber] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)

  // Используем Room Composite Egress (предпочтительно)
  // Это дает: 1 сессия на комнату, микширование на стороне LiveKit, идеально для diarization
  try {
    const { startRoomCompositeTranscription } = await import('./livekit-room-composite-transcriber.js')
    
    // ВАЖНО: Для Railway TCP Proxy используйте проксируемый домен (например, nozomi.proxy.rlwy.net)
    // Это домен, который Railway показывает в разделе Networking → TCP Proxy
    const rtmpHost = process.env.RTMP_HOST || 'localhost' // Для production нужен публичный проксируемый домен
    // Внешний порт для Egress URL (через TCP прокси Railway)
    // Это порт, который Railway показывает в TCP Proxy (например, 58957)
    const rtmpExternalPort = parseInt(process.env.RTMP_EXTERNAL_PORT || process.env.RTMP_PORT || '1937', 10)
    
    console.log(`[ServerTranscriber] RTMP host configuration:`, {
      rtmpHost,
      rtmpExternalPort,
      envRTMP_HOST: process.env.RTMP_HOST,
      envRTMP_EXTERNAL_PORT: process.env.RTMP_EXTERNAL_PORT,
    })
    
    const transcriber = await startRoomCompositeTranscription({
      sessionId,
      sessionSlug,
      rtmpHost,
      rtmpPort: rtmpExternalPort, // Внешний порт для Egress
    })
    
    const wrappedTranscriber: ServerTranscriber = {
      stop: () => transcriber.stop(),
      isActive: () => transcriber.isActive(),
    }
    
    activeTranscribers.set(sessionId, wrappedTranscriber as any)
    console.log(`[ServerTranscriber] ✅ Room Composite transcription started for session ${sessionId}`)
    return wrappedTranscriber
  } catch (error) {
    console.error(`[ServerTranscriber] Failed to start Room Composite transcription, falling back to Track Egress:`, error)
    
    // Fallback на Track Egress (старый подход)
    try {
      const { startEgressTranscription } = await import('./livekit-egress-transcriber.js')
      const egressWebSocketBaseUrl = process.env.EGRESS_WEBSOCKET_BASE_URL || `ws://localhost:3001/egress/audio`
      
      const transcriber = await startEgressTranscription({
        sessionId,
        sessionSlug,
        egressWebSocketUrl: egressWebSocketBaseUrl,
      })
      
      const wrappedTranscriber: ServerTranscriber = {
        stop: () => transcriber.stop(),
        isActive: () => transcriber.isActive(),
      }
      
      activeTranscribers.set(sessionId, wrappedTranscriber as any)
      return wrappedTranscriber
    } catch (fallbackError) {
      console.error(`[ServerTranscriber] Failed to start Track Egress transcription:`, fallbackError)
      throw new Error(`Failed to start transcription: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
    }
  }
}

/**
 * Останавливает серверную транскрипцию для сессии.
 */
export async function stopServerTranscription(sessionId: string): Promise<void> {
  const transcriber = activeTranscribers.get(sessionId)
  if (!transcriber) {
    console.warn(`[ServerTranscriber] No active transcription found for session ${sessionId}`)
    return
  }

  console.log(`[ServerTranscriber] Stopping transcription for session ${sessionId}`)
  
  try {
    await transcriber.stop()
  } catch (error) {
    console.error(`[ServerTranscriber] Error stopping transcription:`, error)
  }
  
  activeTranscribers.delete(sessionId)
}

/**
 * Проверяет, активна ли транскрипция для сессии.
 */
export function isServerTranscriptionActive(sessionId: string): boolean {
  return activeTranscribers.has(sessionId) && activeTranscribers.get(sessionId)!.isActive()
}

// ServerTranscriberImpl класс удален - он использовал livekit-client (браузерный SDK),
// который не работает в Node.js. Теперь используем только Egress API через livekit-server-sdk.


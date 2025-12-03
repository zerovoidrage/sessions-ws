/**
 * Серверный транскрайбер для LiveKit комнат.
 * 
 * Подключается к LiveKit комнате как участник, подписывается на все аудио треки,
 * микширует их и отправляет в Gladia для транскрипции.
 * 
 * Транскрипты публикуются через LiveKit data channel для всех участников комнаты.
 */

// livekit-client не работает в Node.js, используем только livekit-server-sdk
// import { Room, RoomEvent, RemoteTrack, RemoteTrackPublication, RemoteParticipant, Track } from 'livekit-client'
import { AccessToken } from 'livekit-server-sdk'
import { createGladiaBridge, type TranscriptEvent } from './gladia-bridge.js'
import { appendTranscriptChunk } from './append-transcript-chunk.js'
import { AudioProcessor } from './audio-processor.js'
import dotenv from 'dotenv'

dotenv.config()

// Конфигурация LiveKit для серверного окружения
const livekitEnv = {
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  wsUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL!,
}

if (!livekitEnv.apiKey || !livekitEnv.apiSecret || !livekitEnv.wsUrl) {
  console.warn('[ServerTranscriber] Missing LIVEKIT env vars')
}

// Полифиллы для WebRTC в Node.js (если нужны)
// import 'wrtc' // или другой полифилл

export interface StartServerTranscriptionOptions {
  sessionId: string
  sessionSlug: string // room name
}

export interface ServerTranscriber {
  stop(): Promise<void>
  isActive(): boolean
}

// Хранилище активных транскрайберов
const activeTranscribers = new Map<string, ServerTranscriberImpl>()

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
    
    const rtmpHost = process.env.RTMP_HOST || 'localhost' // Для production нужен публичный IP/домен
    const rtmpPort = parseInt(process.env.RTMP_PORT || '1935', 10)
    
    const transcriber = await startRoomCompositeTranscription({
      sessionId,
      sessionSlug,
      rtmpHost,
      rtmpPort,
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

class ServerTranscriberImpl implements ServerTranscriber {
  private room: any = null // Room не работает в Node.js без livekit-client
  private gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  private audioProcessors = new Map<string, AudioProcessor>() // participant identity -> processor
  private globalAudioProcessor = new AudioProcessor() // Для микширования всех потоков
  private isActiveFlag = false
  private audioTrackBuffers = new Map<string, Buffer[]>() // participant identity -> audio chunks
  private audioProcessingInterval: NodeJS.Timeout | null = null

  constructor(
    private sessionId: string,
    private sessionSlug: string
  ) {}

  async start(): Promise<void> {
    try {
      // 1. Генерируем токен для транскрайбера
      const token = await this.generateTranscriberToken()

      // 2. Room не работает в Node.js без livekit-client
      // Используем только Egress API для получения аудио
      // this.room = new Room()
      // await this.room.connect(livekitEnv.wsUrl, token)
      throw new Error('Direct Room connection not supported in Node.js. Use Room Composite Egress instead.')

      console.log(`[ServerTranscriber] Connected to room ${this.sessionSlug}`)

      // 3. Инициализируем Gladia bridge
      const gladiaBridge = await createGladiaBridge()
      if (!gladiaBridge) {
        throw new Error('[ServerTranscriber] Failed to create Gladia bridge')
      }
      this.gladiaBridge = gladiaBridge
      gladiaBridge.onTranscript((event) => this.handleTranscript(event))

      // 4. Создаём аудио контекст для микширования
      // В Node.js это может потребовать полифиллы или альтернативный подход
      // Пока используем упрощённый подход: берём первый доступный аудио трек
      this.setupAudioCapture()

      // 5. Подписываемся на события комнаты
      this.setupRoomEventHandlers()

      this.isActiveFlag = true
    } catch (error) {
      console.error(`[ServerTranscriber] Failed to start transcription:`, error)
      await this.cleanup()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.cleanup()
    this.isActiveFlag = false
  }

  isActive(): boolean {
    return this.isActiveFlag
  }

  private async generateTranscriberToken(): Promise<string> {
    if (!livekitEnv.apiKey || !livekitEnv.apiSecret) {
      throw new Error('LiveKit env not configured')
    }

    const identity = `transcriber-${this.sessionId}`
    const at = new AccessToken(livekitEnv.apiKey, livekitEnv.apiSecret, {
      identity,
      name: 'Server Transcriber',
    })

    at.addGrant({
      room: this.sessionSlug,
      roomJoin: true,
      canPublish: false, // Транскрайбер не публикует медиа
      canSubscribe: true, // Транскрайбер подписывается на аудио треки
    })

    return await at.toJwt()
  }

  private setupRoomEventHandlers(): void {
    // Room не работает в Node.js без livekit-client
    // Используем только Egress API
    console.warn('[ServerTranscriber] Room event handlers not supported in Node.js')
  }

  private setupAudioCapture(): void {
    // Настраиваем периодическую отправку микшированного аудио в Gladia
    // Это будет работать, когда мы получим аудио данные из треков
    this.startAudioProcessingLoop()
  }

  private startAudioProcessingLoop(): void {
    // Периодически обрабатываем накопленные аудио чанки
    this.audioProcessingInterval = setInterval(() => {
      if (!this.isActiveFlag || !this.gladiaBridge) {
        if (this.audioProcessingInterval) {
          clearInterval(this.audioProcessingInterval)
          this.audioProcessingInterval = null
        }
        return
      }

      this.processMixedAudio()
    }, 200) // Каждые 200ms обрабатываем аудио
  }

  private processMixedAudio(): void {
    // Собираем все аудио чанки от всех участников
    const allChunks: Buffer[] = []
    
    for (const chunks of this.audioTrackBuffers.values()) {
      if (chunks.length > 0) {
        allChunks.push(...chunks)
      }
    }

    // Очищаем буферы
    this.audioTrackBuffers.clear()

    if (allChunks.length === 0) {
      return
    }

    // Микшируем все чанки в один
    const mixed = AudioProcessor.mixBuffers(allChunks)
    
    // Отправляем в Gladia
    if (this.gladiaBridge && mixed.length > 0) {
      this.gladiaBridge.sendAudio(mixed)
    }
  }

  private handleAudioTrack(track: any, participant: any): void {
    console.log(`[ServerTranscriber] Handling audio track from ${participant.identity}`)
    
    // Создаём процессор для этого участника
    if (!this.audioProcessors.has(participant.identity)) {
      this.audioProcessors.set(participant.identity, new AudioProcessor())
      this.audioTrackBuffers.set(participant.identity, [])
    }

    // ВАЖНО: В Node.js мы не можем напрямую получить аудио данные из RemoteTrack
    // без полифиллов WebRTC или LiveKit Egress API.
    // 
    // Варианты реализации:
    // 1. Использовать LiveKit Egress API для получения аудио потока
    // 2. Использовать полифиллы WebRTC (wrtc, node-webrtc) для работы с треками
    // 3. Использовать отдельный процесс с браузером (puppeteer) для захвата аудио
    //
    // Пока оставляем заглушку - реальная реализация потребует одного из этих подходов
    
    // Для временной работы можно использовать подход с WebSocket от клиентов,
    // но это противоречит требованию "браузер больше не шлёт аудио на STT-сервер"
    
    console.warn(`[ServerTranscriber] Audio track processing not fully implemented - requires WebRTC polyfills or Egress API`)
  }

  private handleTranscript(event: TranscriptEvent): void {
    if (!this.room || !this.gladiaBridge) return

    // 1. Публикуем транскрипт через LiveKit data channel
    const payload = {
      type: 'transcript',
      speakerId: 'room', // Пока используем 'room' для серверной транскрипции
      speakerName: 'Meeting',
      text: event.text,
      isFinal: event.isFinal,
      ts: Date.now(),
      utterance_id: event.utteranceId,
    }

    // Room не работает в Node.js, публикация через data channel недоступна
    // Транскрипты отправляются через WebSocket сервер
    console.warn('[ServerTranscriber] Data channel publishing not available in Node.js')

    // 2. Сохраняем финальные транскрипты в БД
    if (event.isFinal) {
      appendTranscriptChunk({
        sessionSlug: this.sessionSlug,
        participantIdentity: undefined, // Серверная транскрипция не привязана к конкретному участнику
        utteranceId: event.utteranceId,
        text: event.text,
        isFinal: true,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        sessionId: this.sessionId,
      }).catch((error) => {
        console.error('[ServerTranscriber] Failed to append transcript chunk:', error)
      })
    }
  }

  private async cleanup(): Promise<void> {
    // Останавливаем обработку аудио
    if (this.audioProcessingInterval) {
      clearInterval(this.audioProcessingInterval)
      this.audioProcessingInterval = null
    }

    // Финальная обработка оставшихся аудио чанков
    if (this.gladiaBridge) {
      this.processMixedAudio()
    }

    if (this.gladiaBridge) {
      this.gladiaBridge.close()
      this.gladiaBridge = null
    }

    if (this.room) {
      this.room.disconnect()
      this.room = null
    }

    this.audioProcessors.clear()
    this.audioTrackBuffers.clear()
  }
}


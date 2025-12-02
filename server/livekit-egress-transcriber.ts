/**
 * Серверный транскрайбер через LiveKit Egress API.
 * 
 * Использует LiveKit Egress для получения аудио потока из комнаты
 * и отправки его в Gladia для транскрипции.
 * 
 * Преимущества:
 * - Не требует WebRTC полифиллов в Node.js
 * - Официальный подход от LiveKit
 * - Стабильно работает в production
 */

import { EgressClient, RoomServiceClient } from 'livekit-server-sdk'
import { WebSocket } from 'ws'
import { createGladiaBridge, type TranscriptEvent } from './gladia-bridge.js'
import { appendTranscriptChunk } from './append-transcript-chunk.js'
import { AudioProcessor } from './audio-processor.js'
import { AudioDecoder } from './audio-decoder.js'
import dotenv from 'dotenv'

dotenv.config()

// Конфигурация LiveKit для серверного окружения
// Преобразуем NEXT_PUBLIC_LIVEKIT_URL в HTTP URL если нужно
function getHttpUrl(): string {
  if (process.env.LIVEKIT_HTTP_URL) {
    return process.env.LIVEKIT_HTTP_URL
  }
  if (process.env.NEXT_PUBLIC_LIVEKIT_URL) {
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL.trim()
    return wsUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
  }
  throw new Error('LIVEKIT_HTTP_URL or NEXT_PUBLIC_LIVEKIT_URL must be set')
}

const livekitEnv = {
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  wsUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL!,
  httpUrl: getHttpUrl(),
}

if (!livekitEnv.apiKey || !livekitEnv.apiSecret || !livekitEnv.wsUrl || !livekitEnv.httpUrl) {
  console.warn('[EgressTranscriber] Missing LIVEKIT env vars', {
    hasApiKey: !!livekitEnv.apiKey,
    hasApiSecret: !!livekitEnv.apiSecret,
    hasWsUrl: !!livekitEnv.wsUrl,
    hasHttpUrl: !!livekitEnv.httpUrl,
    nextPublicUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'NOT SET',
    httpUrl: process.env.LIVEKIT_HTTP_URL || 'NOT SET',
  })
}

export interface StartEgressTranscriptionOptions {
  sessionId: string
  sessionSlug: string // room name
  egressWebSocketUrl?: string // URL для получения аудио потока от Egress
}

export interface EgressTranscriber {
  stop(): Promise<void>
  isActive(): boolean
  egressId?: string
}

// Хранилище активных транскрайберов
const activeEgressTranscribers = new Map<string, EgressTranscriberImpl>()

// Хранилище ожидающих WebSocket соединений от Egress
// Формат: `${sessionId}/${trackId}` -> WebSocket
const pendingEgressConnections = new Map<string, WebSocket>()

/**
 * Запускает серверную транскрипцию через LiveKit Egress API.
 * 
 * Создаёт Egress сессию, которая:
 * 1. Получает аудио поток из LiveKit комнаты
 * 2. Отправляет его на наш WebSocket сервер
 * 3. Мы обрабатываем аудио и отправляем в Gladia
 * 4. Публикуем транскрипты через LiveKit data channel
 */
export async function startEgressTranscription(
  options: StartEgressTranscriptionOptions
): Promise<EgressTranscriber> {
  const { sessionId, sessionSlug } = options

  // Проверяем, не запущена ли уже транскрипция для этой сессии
  if (activeEgressTranscribers.has(sessionId)) {
    console.warn(`[EgressTranscriber] Transcription already active for session ${sessionId}`)
    return activeEgressTranscribers.get(sessionId)!
  }

  console.log(`[EgressTranscriber] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)

  const transcriber = new EgressTranscriberImpl(sessionId, sessionSlug, options.egressWebSocketUrl)
  await transcriber.start()

  activeEgressTranscribers.set(sessionId, transcriber)
  
  // Применяем сохранённые WebSocket соединения (если Egress подключился раньше)
  applyPendingEgressConnections(sessionId, transcriber)

  return transcriber
}

/**
 * Останавливает серверную транскрипцию для сессии.
 */
export async function stopEgressTranscription(sessionId: string): Promise<void> {
  const transcriber = activeEgressTranscribers.get(sessionId)
  if (!transcriber) {
    console.warn(`[EgressTranscriber] No active transcription found for session ${sessionId}`)
    return
  }

  console.log(`[EgressTranscriber] Stopping transcription for session ${sessionId}`)
  await transcriber.stop()
  activeEgressTranscribers.delete(sessionId)
}

/**
 * Проверяет, активна ли транскрипция для сессии.
 */
export function isEgressTranscriptionActive(sessionId: string): boolean {
  return activeEgressTranscribers.has(sessionId) && activeEgressTranscribers.get(sessionId)!.isActive()
}

/**
 * Регистрирует WebSocket соединение от Egress для обработки аудио.
 * Вызывается из ws/server/index.ts когда Egress подключается.
 */
export function registerEgressWebSocketConnection(
  sessionId: string,
  trackId: string,
  ws: WebSocket
): void {
  const transcriber = activeEgressTranscribers.get(sessionId)
  if (!transcriber) {
    console.warn(`[EgressTranscriber] No active transcriber found for session ${sessionId}, storing connection`)
    // Сохраняем соединение для будущего использования (когда транскрайбер запустится)
    pendingEgressConnections.set(`${sessionId}/${trackId}`, ws)
    
    // Устанавливаем обработчики для сохранённого соединения
    ws.on('message', () => {
      // Данные будут обработаны когда транскрайбер запустится
    })
    
    ws.on('close', () => {
      pendingEgressConnections.delete(`${sessionId}/${trackId}`)
    })
    
    return
  }

  transcriber.registerEgressWebSocket(trackId, ws)
  
  // Проверяем, не было ли это соединение сохранено ранее
  pendingEgressConnections.delete(`${sessionId}/${trackId}`)
}

/**
 * Применяет сохранённые WebSocket соединения к транскрайберу.
 * Вызывается после запуска транскрайбера.
 */
function applyPendingEgressConnections(sessionId: string, transcriber: EgressTranscriberImpl): void {
  for (const [key, ws] of pendingEgressConnections.entries()) {
    const [savedSessionId, trackId] = key.split('/')
    if (savedSessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      transcriber.registerEgressWebSocket(trackId, ws)
      pendingEgressConnections.delete(key)
    }
  }
}

class EgressTranscriberImpl implements EgressTranscriber {
  private egressClient: EgressClient | null = null
  private roomService: RoomServiceClient | null = null
  private egressIds: string[] = [] // Массив egress ID для всех треков
  private gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  private egressWebSockets = new Map<string, WebSocket>() // trackId -> WebSocket
  // Убрали подключение к комнате через livekit-client (не работает в Node.js)
  // Транскрипты отправляются клиентам через WebSocket
  private audioProcessor = new AudioProcessor()
  private audioDecoder = new AudioDecoder() // Декодер Opus → PCM16
  private audioBuffers = new Map<string, Buffer[]>() // trackId -> audio chunks (Opus)
  private isActiveFlag = false

  constructor(
    private sessionId: string,
    private sessionSlug: string,
    private egressWebSocketUrl?: string
  ) {
    this.egressClient = new EgressClient(
      livekitEnv.httpUrl,
      livekitEnv.apiKey,
      livekitEnv.apiSecret
    )
    this.roomService = new RoomServiceClient(
      livekitEnv.httpUrl,
      livekitEnv.apiKey,
      livekitEnv.apiSecret
    )
  }

  async start(): Promise<void> {
    try {
      // 1. Проверяем, что декодер инициализирован
      if (!this.audioDecoder.isInitialized()) {
        console.warn('[EgressTranscriber] ⚠️ Audio decoder not initialized, transcription may not work correctly')
        // Не прерываем процесс, но предупреждаем
      }

      // 2. Инициализируем Gladia bridge
      this.gladiaBridge = await createGladiaBridge()
      this.gladiaBridge.onTranscript((event) => this.handleTranscript(event))

      // 3. Получаем список аудио треков и запускаем Track Egress для каждого
      // (не подключаемся к комнате через livekit-client, т.к. он не работает в Node.js)
      await this.startTrackEgressForAllTracks()

      // 5. Запускаем цикл обработки аудио
      this.startAudioProcessingLoop()

      this.isActiveFlag = true
      console.log(`[EgressTranscriber] ✅ Transcription started successfully for session ${this.sessionId}`)
    } catch (error) {
      console.error(`[EgressTranscriber] Failed to start transcription:`, error)
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

  get egressId(): string | undefined {
    return this.egressIds.length > 0 ? this.egressIds[0] : undefined
  }

  /**
   * Получает список всех аудио треков в комнате и запускает Track Egress для каждого.
   * 
   * Использует Track Egress с WebSocket выходом для real-time транскрипции.
   * Согласно документации LiveKit, Track Egress идеально подходит для:
   * "streaming an audio track to a captioning service via websocket"
   * 
   * ВАЖНО: Для работы Egress нужен настроенный LiveKit Egress сервис.
   * В LiveKit Cloud Egress доступен автоматически (см. скриншоты настроек проекта).
   * 
   * Лимиты в LiveKit Cloud:
   * - Concurrent Egress requests: Limit 2 (по умолчанию)
   * - При 5 участниках = 5 Egress сессий (может превысить лимит)
   * - Можно увеличить через upgrade плана или использовать Room Composite для микширования
   */
  private async startTrackEgressForAllTracks(): Promise<void> {
    if (!this.egressClient || !this.roomService) {
      throw new Error('EgressClient or RoomService not initialized')
    }

    try {
      // Получаем список участников через RoomService API
      console.log(`[EgressTranscriber] Getting participants for room: ${this.sessionSlug}`)
      const participants = await this.roomService.listParticipants(this.sessionSlug)
      
      console.log(`[EgressTranscriber] Found ${participants?.length || 0} participants in room`)
      
      if (!participants || participants.length === 0) {
        console.warn(`[EgressTranscriber] No participants found in room ${this.sessionSlug}. Waiting for participants to join...`)
        // Планируем повторную попытку через некоторое время
        setTimeout(() => {
          this.startTrackEgressForAllTracks().catch((error) => {
            console.error('[EgressTranscriber] Failed to retry getting tracks:', error)
          })
        }, 5000) // Повтор через 5 секунд
        return
      }

      // Получаем все аудио треки из комнаты
      const audioTracks: Array<{ trackId: string, participantIdentity: string }> = []

      // Обрабатываем участников комнаты
      for (const participant of participants) {
        // Получаем детальную информацию о участнике, включая треки
        try {
          const participantInfo = await this.roomService.getParticipant(this.sessionSlug, participant.identity)
          
          // В LiveKit Server SDK ParticipantInfo содержит tracks
          if (participantInfo.tracks && participantInfo.tracks.length > 0) {
            for (const trackInfo of participantInfo.tracks) {
              // Проверяем, что это аудио трек
              // TrackType.AUDIO = 0 (согласно протоколу LiveKit)
              if (trackInfo.type === 0 && trackInfo.sid) {
                audioTracks.push({
                  trackId: trackInfo.sid,
                  participantIdentity: participant.identity || 'unknown',
                })
                console.log(`[EgressTranscriber] Found audio track: ${trackInfo.sid} from ${participant.identity}`)
              }
            }
          }
        } catch (error) {
          console.warn(`[EgressTranscriber] Failed to get participant info for ${participant.identity}:`, error)
        }
      }

      if (audioTracks.length === 0) {
        console.warn('[EgressTranscriber] No audio tracks found in room. Waiting for participants to publish tracks...')
        // Планируем повторную попытку через некоторое время
        setTimeout(() => {
          this.startTrackEgressForAllTracks().catch((error) => {
            console.error('[EgressTranscriber] Failed to retry getting tracks:', error)
          })
        }, 5000) // Повтор через 5 секунд
        return
      }

      console.log(`[EgressTranscriber] Found ${audioTracks.length} audio tracks, starting Track Egress...`)

      // Запускаем Track Egress для каждого трека
      for (const { trackId, participantIdentity } of audioTracks) {
        await this.startTrackEgressForTrack(trackId, participantIdentity)
      }
    } catch (error) {
      console.error('[EgressTranscriber] Failed to get room info:', error)
      throw error
    }
  }

  /**
   * Запускает Track Egress для конкретного трека с WebSocket выходом.
   * 
   * Включает retry логику и graceful degradation при ошибках.
   */
  private async startTrackEgressForTrack(trackId: string, participantIdentity: string, retryCount = 0): Promise<void> {
    if (!this.egressClient) {
      throw new Error('EgressClient not initialized')
    }

    const maxRetries = 3
    const retryDelay = 1000 * (retryCount + 1) // Экспоненциальная задержка: 1s, 2s, 3s

    // WebSocket URL для получения аудио от этого трека
    // ВАЖНО: URL должен быть доступен извне (не localhost в production)
    // Egress подключается к этому URL, поэтому он должен быть публичным
    const baseUrl = this.egressWebSocketUrl || process.env.EGRESS_WEBSOCKET_BASE_URL || `ws://localhost:3001/egress/audio`
    const websocketUrl = `${baseUrl}/${this.sessionId}/${trackId}`
    
    console.log(`[EgressTranscriber] Starting Track Egress for ${participantIdentity} (track: ${trackId}, attempt: ${retryCount + 1}/${maxRetries + 1})`)

    try {
      // Запускаем Track Egress с WebSocket выходом
      // ВАЖНО: Track Egress поддерживает WebSocket выход напрямую (в отличие от Room Composite)
      const info = await this.egressClient.startTrackEgress(
        this.sessionSlug,
        websocketUrl, // WebSocket URL для получения аудио
        trackId,
      )

      this.egressIds.push(info.egressId)
      console.log(`[EgressTranscriber] ✅ Track Egress started for ${participantIdentity} (track: ${trackId}): ${info.egressId}`)
      console.log(`[EgressTranscriber] Waiting for Egress to connect to: ${websocketUrl}`)
      
      // ВАЖНО: Egress подключится к нашему серверу автоматически
      // WebSocket соединение будет обработано в ws/server/index.ts
      // и передано в транскрайбер через registerEgressWebSocket()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isLimitError = errorMessage.includes('limit') || 
                          errorMessage.includes('quota') || 
                          errorMessage.includes('concurrent') ||
                          errorMessage.includes('429')
      
      const isRetryableError = !isLimitError && retryCount < maxRetries

      if (isLimitError) {
        // Превышение лимитов - не retry, используем fallback
        console.warn(`[EgressTranscriber] ⚠️ Egress limit reached for track ${trackId}, using fallback`)
        await this.fallbackToClientTranscription(trackId, participantIdentity)
      } else if (isRetryableError) {
        // Retryable ошибка - повторяем попытку
        console.warn(`[EgressTranscriber] ⚠️ Failed to start Track Egress for track ${trackId} (attempt ${retryCount + 1}), retrying in ${retryDelay}ms:`, errorMessage)
        
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        return this.startTrackEgressForTrack(trackId, participantIdentity, retryCount + 1)
      } else {
        // Не retryable ошибка или превышен лимит retry - используем fallback
        console.error(`[EgressTranscriber] ❌ Failed to start Track Egress for track ${trackId} after ${retryCount + 1} attempts:`, errorMessage)
        await this.fallbackToClientTranscription(trackId, participantIdentity)
      }
    }
  }

  /**
   * Fallback механизм: использует клиентский подход для транскрипции.
   * Вызывается при ошибках Egress или превышении лимитов.
   */
  private async fallbackToClientTranscription(trackId: string, participantIdentity: string): Promise<void> {
    console.log(`[EgressTranscriber] 🔄 Using fallback transcription for track ${trackId} (${participantIdentity})`)
    
    // TODO: Реализовать fallback через livekit-client
    // Пока просто логируем, что fallback нужен
    // В будущем можно использовать существующий код из livekit-transcriber.ts
    
    // Временное решение: просто логируем
    // В production нужно будет реализовать полноценный fallback
    console.warn(`[EgressTranscriber] Fallback transcription not yet implemented for track ${trackId}`)
  }

  /**
   * Регистрирует обработчик для WebSocket соединения от Track Egress.
   * 
   * ВАЖНО: Egress подключается к нашему серверу, а не наоборот.
   * Этот метод вызывается из ws/server/index.ts когда Egress подключается.
   */
  registerEgressWebSocket(trackId: string, ws: WebSocket): void {
    console.log(`[EgressTranscriber] ✅ Registering Egress WebSocket for track ${trackId}`)
    
    // Если уже есть соединение для этого трека, закрываем старое
    const existing = this.egressWebSockets.get(trackId)
    if (existing && existing.readyState === WebSocket.OPEN) {
      console.log(`[EgressTranscriber] Closing existing WebSocket for track ${trackId}`)
      existing.close()
    }
    
    this.egressWebSockets.set(trackId, ws)

    let consecutiveErrors = 0
    const maxConsecutiveErrors = 5

    ws.on('message', (data: WebSocket.Data) => {
      try {
        // Обрабатываем аудио данные от Egress для этого трека
        this.handleEgressAudioData(trackId, data)
        // Сбрасываем счётчик ошибок при успешной обработке
        consecutiveErrors = 0
      } catch (error) {
        consecutiveErrors++
        console.error(`[EgressTranscriber] Error processing audio for track ${trackId} (${consecutiveErrors}/${maxConsecutiveErrors}):`, error)
        
        // Если слишком много ошибок подряд - закрываем соединение
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[EgressTranscriber] Too many consecutive errors for track ${trackId}, closing connection`)
          ws.close(1000, 'Too many errors')
        }
      }
    })

    ws.on('error', (error) => {
      console.error(`[EgressTranscriber] ❌ Track Egress WebSocket error for ${trackId}:`, error)
      this.egressWebSockets.delete(trackId)
      
      // При ошибке соединения можно попробовать переподключиться
      // Но это зависит от того, сможет ли Egress переподключиться автоматически
    })

    ws.on('close', (code, reason) => {
      console.log(`[EgressTranscriber] Track Egress WebSocket closed for track ${trackId} (code: ${code}, reason: ${reason?.toString()})`)
      this.egressWebSockets.delete(trackId)
      
      // Если соединение закрыто неожиданно (не нормальное закрытие)
      // можно попробовать перезапустить Egress для этого трека
      if (code !== 1000 && code !== 1001) {
        console.warn(`[EgressTranscriber] Unexpected WebSocket close for track ${trackId}, may need to restart Egress`)
        // TODO: Реализовать автоматический перезапуск Egress при неожиданном закрытии
      }
    })
  }

  /**
   * Запускает цикл обработки и микширования аудио от всех треков.
   */
  private startAudioProcessingLoop(): void {
    // Периодически обрабатываем накопленные аудио чанки от всех треков
    const interval = setInterval(() => {
      if (!this.isActiveFlag || !this.gladiaBridge) {
        clearInterval(interval)
        return
      }

      this.processMixedAudio()
    }, 200) // Каждые 200ms обрабатываем и микшируем аудио
  }

  /**
   * Обрабатывает аудио данные, полученные от Track Egress для конкретного трека.
   * 
   * ВАЖНО: Формат данных от Track Egress - это Opus (WebRTC формат).
   * Декодируем Opus → PCM16 16kHz моно для Gladia.
   */
  private handleEgressAudioData(trackId: string, data: WebSocket.Data): void {
    if (!this.gladiaBridge) return

    try {
      // Конвертируем данные в Buffer
      const opusBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)

      // Проверяем, что декодер инициализирован
      if (!this.audioDecoder.isInitialized()) {
        console.warn(`[EgressTranscriber] Audio decoder not initialized, skipping audio data for track ${trackId}`)
        return
      }

      // Декодируем Opus → PCM16
      const pcmBuffer = this.audioDecoder.decodeOpusToPCM16(opusBuffer)
      
      if (!pcmBuffer) {
        console.warn(`[EgressTranscriber] Failed to decode Opus for track ${trackId}, skipping`)
        return
      }

      // Сохраняем декодированный PCM16 буфер для этого трека
      if (!this.audioBuffers.has(trackId)) {
        this.audioBuffers.set(trackId, [])
      }
      this.audioBuffers.get(trackId)!.push(pcmBuffer)
    } catch (error) {
      console.error(`[EgressTranscriber] Error processing Egress audio data for track ${trackId}:`, error)
    }
  }

  /**
   * Обрабатывает и микширует аудио от всех треков, отправляет в Gladia.
   * 
   * ВАЖНО: Аудио уже декодировано из Opus в PCM16 в handleEgressAudioData.
   * Здесь просто микшируем PCM16 буферы и отправляем в Gladia.
   */
  private processMixedAudio(): void {
    if (!this.gladiaBridge || this.audioBuffers.size === 0) {
      return
    }

    // Собираем все декодированные PCM16 чанки от всех треков
    const allChunks: Buffer[] = []
    
    for (const chunks of this.audioBuffers.values()) {
      if (chunks.length > 0) {
        allChunks.push(...chunks)
      }
    }

    // Очищаем буферы
    this.audioBuffers.clear()

    if (allChunks.length === 0) {
      return
    }

    // Микшируем все PCM16 чанки в один
    const mixed = AudioProcessor.mixBuffers(allChunks)
    
    // Обрабатываем через AudioProcessor для буферизации
    const processed = this.audioProcessor.processChunk({
      data: mixed,
      sampleRate: 16000,
      channels: 1,
      timestamp: Date.now(),
    })

    // Если процессор вернул готовый чанк, отправляем в Gladia
    if (processed && processed.length > 0) {
      this.gladiaBridge.sendAudio(processed)
    }
  }

  /**
   * Обрабатывает транскрипты от Gladia.
   */
  private handleTranscript(event: TranscriptEvent): void {
    if (!this.gladiaBridge) return

    // 1. Отправляем транскрипт всем клиентам через WebSocket
    // (используем механизм из client-connection.ts)
    this.broadcastTranscriptToClients(event)

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
        console.error('[EgressTranscriber] Failed to append transcript chunk:', error)
      })
    }
  }

  /**
   * Отправляет транскрипт всем клиентам, подключенным к сессии через WebSocket.
   */
  private broadcastTranscriptToClients(event: TranscriptEvent): void {
    // Используем динамический импорт, чтобы избежать циклических зависимостей
    import('./client-connection.js')
      .then(({ broadcastToSessionClients }) => {
        const payload = {
          type: 'transcription',
          text: event.text,
          is_final: event.isFinal,
          utterance_id: event.utteranceId,
          speakerId: 'room', // Серверная транскрипция - общий поток
          speakerName: 'Meeting',
        }

        broadcastToSessionClients(this.sessionSlug, payload)
      })
      .catch((error) => {
        console.error('[EgressTranscriber] Failed to broadcast transcript to clients:', error)
      })
  }

  private async cleanup(): Promise<void> {
    // Останавливаем все Egress сессии
    if (this.egressIds.length > 0 && this.egressClient) {
      for (const egressId of this.egressIds) {
        try {
          await this.egressClient.stopEgress(egressId)
          console.log(`[EgressTranscriber] Egress session stopped: ${egressId}`)
        } catch (error) {
          console.error(`[EgressTranscriber] Failed to stop Egress session ${egressId}:`, error)
        }
      }
      this.egressIds = []
    }

    // Закрываем все WebSocket соединения
    for (const [trackId, ws] of this.egressWebSockets.entries()) {
      try {
        ws.close()
      } catch (error) {
        console.error(`[EgressTranscriber] Error closing WebSocket for track ${trackId}:`, error)
      }
    }
    this.egressWebSockets.clear()

    // Убрали подключение к комнате

    // Закрываем Gladia bridge
    if (this.gladiaBridge) {
      this.gladiaBridge.close()
      this.gladiaBridge = null
    }

    // Освобождаем ресурсы декодера
    if (this.audioDecoder) {
      this.audioDecoder.destroy()
    }

    // Финальная обработка оставшихся аудио данных
    const remaining = this.audioProcessor.flush()
    if (remaining && this.gladiaBridge) {
      this.gladiaBridge.sendAudio(remaining)
    }
  }
}


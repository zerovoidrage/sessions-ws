/**
 * Room Composite Egress транскрайбер.
 * 
 * Архитектура:
 * LiveKit Room Composite Egress → RTMP → RTMP Ingest Server → PCM16 → Gladia
 * 
 * Преимущества:
 * - 1 Egress сессия на комнату (вместо N Track Egress)
 * - Микширование на стороне LiveKit (оптимизировано)
 * - Идеально для speaker diarization в Gladia
 */

import { EgressClient, RoomServiceClient, StreamProtocol, StreamOutput } from 'livekit-server-sdk'
import { createRTMPIngest, type RTMPIngest } from './rtmp-ingest.js'
import { getLiveKitConfig } from './livekit-env.js'

export interface RoomCompositeTranscriber {
  stop(): Promise<void>
  isActive(): boolean
  getEgressId(): string | undefined
  getRTMPUrl(): string
}

export interface StartRoomCompositeTranscriptionOptions {
  sessionId: string
  sessionSlug: string
  rtmpPort?: number // Внешний порт для Egress URL (через TCP прокси)
  rtmpHost?: string // Хост для RTMP (по умолчанию localhost, для production нужен публичный IP)
}

/**
 * Запускает Room Composite Egress транскрипцию для сессии.
 */
export async function startRoomCompositeTranscription(
  options: StartRoomCompositeTranscriptionOptions
): Promise<RoomCompositeTranscriber> {
  // Определяем RTMP хост автоматически для разных платформ
  const defaultRtmpHost = 
    process.env.RAILWAY_PUBLIC_DOMAIN || // Railway
    (process.env.FLY_APP_NAME ? `${process.env.FLY_APP_NAME}.fly.dev` : undefined) || // Fly.io
    process.env.RTMP_HOST || 
    'localhost'
  
  // Внешний порт для Egress URL (через TCP прокси Railway)
  // Если не указан, используем RTMP_EXTERNAL_PORT или RTMP_PORT из переменных окружения
  const externalPort = options.rtmpPort || 
    parseInt(process.env.RTMP_EXTERNAL_PORT || process.env.RTMP_PORT || '1937', 10)
  
  // Внутренний порт для RTMP сервера (где FFmpeg подключается локально)
  // Используем RTMP_INTERNAL_PORT или RTMP_PORT из переменных окружения
  const internalPort = parseInt(
    process.env.RTMP_INTERNAL_PORT || process.env.RTMP_PORT || '1937',
    10
  )
  
  const { sessionId, sessionSlug, rtmpHost = defaultRtmpHost } = options

  console.log(`[RoomCompositeTranscriber] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)

  const livekitConfig = getLiveKitConfig()
  const egressClient = new EgressClient(
    livekitConfig.httpUrl,
    livekitConfig.apiKey,
    livekitConfig.apiSecret
  )

  // RTMP URL для приема потока от Egress
  // ВАЖНО: Для production rtmpHost должен быть публичным IP/доменом
  // Используем внешний порт (через TCP прокси Railway)
  const rtmpUrl = `rtmp://${rtmpHost}:${externalPort}/live/${sessionSlug}`

  try {
    // 1. Запускаем RTMP Ingest сервер для приема потока
    // Используем внутренний порт (где слушает локальный RTMP сервер)
    const rtmpIngest = await createRTMPIngest({
      sessionId,
      sessionSlug,
      rtmpPort: internalPort, // Внутренний порт из переменных окружения
    })

    // 2. Запускаем Room Composite Egress с audio-only и RTMP выходом
    const streamOutput = new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls: [rtmpUrl],
    })
    const egressInfo = await egressClient.startRoomCompositeEgress(
      sessionSlug,
      streamOutput,
      {
        audioOnly: true, // Только аудио для транскрипции
      }
    )

    console.log(`[RoomCompositeTranscriber] ✅ Room Composite Egress started: ${egressInfo.egressId}`)
    console.log(`[RoomCompositeTranscriber] Egress streaming to: ${rtmpUrl}`)

    return new RoomCompositeTranscriberImpl(
      sessionId,
      sessionSlug,
      egressClient,
      egressInfo.egressId,
      rtmpIngest,
      rtmpUrl
    )
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isUnauthorized = errorMessage.includes('Unauthorized') ||
                          errorMessage.includes('invalid token') ||
                          errorMessage.includes('go-jose/go-jose')

    if (isUnauthorized) {
      const enhancedError = new Error(
        `LiveKit Unauthorized: invalid token (check LIVEKIT_API_KEY / LIVEKIT_API_SECRET). ` +
        `Original error: ${errorMessage}`
      )
      console.error(`[RoomCompositeTranscriber] Failed to start transcription:`, {
        sessionId,
        sessionSlug,
        error: errorMessage,
        enhancedMessage: enhancedError.message,
      })
      throw enhancedError
    }

    console.error(`[RoomCompositeTranscriber] Failed to start transcription:`, {
      sessionId,
      sessionSlug,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

class RoomCompositeTranscriberImpl implements RoomCompositeTranscriber {
  private isActiveFlag = true

  constructor(
    private sessionId: string,
    private sessionSlug: string,
    private egressClient: EgressClient,
    private egressId: string,
    private rtmpIngest: RTMPIngest,
    private rtmpUrl: string
  ) {}

  async stop(): Promise<void> {
    if (!this.isActiveFlag) {
      return
    }

    console.log(`[RoomCompositeTranscriber] Stopping transcription for session ${this.sessionId}`)

    try {
      // Останавливаем Egress
      if (this.egressId) {
        await this.egressClient.stopEgress(this.egressId)
        console.log(`[RoomCompositeTranscriber] Egress stopped: ${this.egressId}`)
      }
    } catch (error) {
      console.error(`[RoomCompositeTranscriber] Failed to stop Egress:`, error)
    }

    try {
      // Останавливаем RTMP Ingest
      await this.rtmpIngest.stop()
    } catch (error) {
      console.error(`[RoomCompositeTranscriber] Failed to stop RTMP Ingest:`, error)
    }

    this.isActiveFlag = false
    console.log(`[RoomCompositeTranscriber] ✅ Transcription stopped for session ${this.sessionId}`)
  }

  isActive(): boolean {
    return this.isActiveFlag && this.rtmpIngest.isActive()
  }

  getEgressId(): string | undefined {
    return this.egressId
  }

  getRTMPUrl(): string {
    return this.rtmpUrl
  }
}


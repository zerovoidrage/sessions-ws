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
  // ВАЖНО: Для Railway TCP Proxy нужно использовать проксируемый домен (например, nozomi.proxy.rlwy.net)
  // НЕ используйте основной домен сервиса (например, ws-production-dbcc.up.railway.app)
  const defaultRtmpHost = 
    process.env.RTMP_HOST || // Явно указанный RTMP хост (предпочтительно для Railway TCP Proxy)
    process.env.RAILWAY_PUBLIC_DOMAIN || // Railway (fallback, но лучше использовать RTMP_HOST из TCP Proxy)
    (process.env.FLY_APP_NAME ? `${process.env.FLY_APP_NAME}.fly.dev` : undefined) || // Fly.io
    'localhost'
  
  // Внешний порт для Egress URL (через TCP прокси Railway)
  // ВАЖНО: Для Railway TCP Proxy это должен быть внешний порт из прокси (например, 58957)
  // НЕ внутренний порт (1937)
  const externalPort = options.rtmpPort || 
    parseInt(process.env.RTMP_EXTERNAL_PORT || process.env.RTMP_PORT || '1937', 10)
  
  // Внутренний порт для RTMP сервера (где FFmpeg подключается локально)
  // Это порт, на котором RTMP сервер слушает внутри контейнера (обычно 1937)
  const internalPort = parseInt(
    process.env.RTMP_INTERNAL_PORT || process.env.RTMP_PORT || '1937',
    10
  )
  
  const { sessionId, sessionSlug, rtmpHost = defaultRtmpHost } = options

  console.log(`[RoomCompositeTranscriber] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)
  console.log(`[RoomCompositeTranscriber] RTMP configuration:`, {
    rtmpHost,
    externalPort,
    internalPort,
    envRTMP_HOST: process.env.RTMP_HOST,
    envRTMP_EXTERNAL_PORT: process.env.RTMP_EXTERNAL_PORT,
    envRTMP_INTERNAL_PORT: process.env.RTMP_INTERNAL_PORT,
    envRTMP_PORT: process.env.RTMP_PORT,
  })

  const livekitConfig = getLiveKitConfig()
  const egressClient = new EgressClient(
    livekitConfig.httpUrl,
    livekitConfig.apiKey,
    livekitConfig.apiSecret
  )

  // RTMP URL для приема потока от Egress
  // ВАЖНО: Для production rtmpHost должен быть публичным проксируемым доменом (например, nozomi.proxy.rlwy.net)
  // Используем внешний порт (через TCP прокси Railway, например, 58957)
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


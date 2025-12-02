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

import { EgressClient, RoomServiceClient, StreamProtocol } from 'livekit-server-sdk'
import { createRTMPIngest, type RTMPIngest } from './rtmp-ingest.js'
import dotenv from 'dotenv'

dotenv.config()

function getLiveKitEnv() {
  const httpUrl = process.env.LIVEKIT_HTTP_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL?.replace('wss://', 'https://').replace('ws://', 'http://')
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  if (!httpUrl || !apiKey || !apiSecret) {
    throw new Error('LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set')
  }

  return { httpUrl, apiKey, apiSecret }
}

export interface RoomCompositeTranscriber {
  stop(): Promise<void>
  isActive(): boolean
  getEgressId(): string | undefined
  getRTMPUrl(): string
}

export interface StartRoomCompositeTranscriptionOptions {
  sessionId: string
  sessionSlug: string
  rtmpPort?: number
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
  
  const { sessionId, sessionSlug, rtmpPort = 1935, rtmpHost = defaultRtmpHost } = options

  console.log(`[RoomCompositeTranscriber] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)

  const livekitEnv = getLiveKitEnv()
  const egressClient = new EgressClient(
    livekitEnv.httpUrl,
    livekitEnv.apiKey,
    livekitEnv.apiSecret
  )

  // RTMP URL для приема потока от Egress
  // ВАЖНО: Для production rtmpHost должен быть публичным IP/доменом
  // Если используется ngrok, порт может отличаться от 1935
  const rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}/live/${sessionSlug}`

  try {
    // 1. Запускаем RTMP Ingest сервер для приема потока
    const rtmpIngest = await createRTMPIngest({
      sessionId,
      sessionSlug,
      rtmpPort,
    })

    // 2. Запускаем Room Composite Egress с audio-only и RTMP выходом
    const egressInfo = await egressClient.startRoomCompositeEgress(
      sessionSlug,
      {
        stream: {
          protocol: StreamProtocol.RTMP,
          urls: [rtmpUrl],
        },
      },
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
  } catch (error) {
    console.error(`[RoomCompositeTranscriber] Failed to start transcription:`, error)
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


/**
 * Маппинг спикеров: Gladia speaker IDs → Participant identities.
 * 
 * Использует LiveKit active speaker events для определения, кто говорит,
 * и маппит их на speaker IDs от Gladia diarization.
 */

import { RoomServiceClient } from 'livekit-server-sdk'
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

export interface SpeakerMapping {
  speakerId: string // Gladia speaker ID (например, "speaker_0", "speaker_1")
  participantIdentity?: string // LiveKit participant identity
  participantName?: string // Имя участника
  confidence?: number // Уверенность в маппинге (0-1)
}

/**
 * Маппер спикеров для сессии.
 * Отслеживает активных спикеров через LiveKit Room Service API
 * и маппит их на speaker IDs от Gladia.
 */
export class SpeakerMapper {
  private roomService: RoomServiceClient
  private speakerMappings = new Map<string, SpeakerMapping>() // speakerId -> mapping
  private activeSpeakerHistory = new Map<string, Array<{ identity: string, timestamp: number }>>() // speakerId -> history
  private sessionSlug: string
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(sessionSlug: string) {
    this.sessionSlug = sessionSlug
    const env = getLiveKitEnv()
    this.roomService = new RoomServiceClient(env.httpUrl, env.apiKey, env.apiSecret)
  }

  /**
   * Начинает отслеживание активных спикеров.
   */
  async start(): Promise<void> {
    console.log(`[SpeakerMapper] Starting speaker tracking for room ${this.sessionSlug}`)
    
    // Периодически опрашиваем Room Service API для получения активных спикеров
    // В production можно использовать WebSocket события от LiveKit
    this.pollingInterval = setInterval(async () => {
      try {
        await this.updateActiveSpeakers()
      } catch (error) {
        console.error(`[SpeakerMapper] Failed to update active speakers:`, error)
      }
    }, 2000) // Каждые 2 секунды
  }

  /**
   * Обновляет информацию об активных спикерах через Room Service API.
   */
  private async updateActiveSpeakers(): Promise<void> {
    try {
      const participants = await this.roomService.listParticipants(this.sessionSlug)
      
      // Получаем информацию о каждом участнике
      for (const participant of participants) {
        try {
          const participantInfo = await this.roomService.getParticipant(this.sessionSlug, participant.identity)
          
          // Проверяем, есть ли у участника активный аудио трек
          const hasActiveAudio = participantInfo.tracks?.some(
            track => track.type === 0 && !track.muted // AUDIO и не muted
          )
          
          if (hasActiveAudio) {
            // Участник говорит - обновляем историю
            // В реальности нужно использовать active speaker events от LiveKit
            // Здесь упрощенная версия для демонстрации
          }
        } catch (error) {
          // Игнорируем ошибки для отдельных участников
        }
      }
    } catch (error) {
      console.error(`[SpeakerMapper] Failed to get participants:`, error)
    }
  }

  /**
   * Маппит Gladia speaker ID на participant identity на основе временных меток.
   */
  mapSpeakerToParticipant(
    speakerId: string,
    timestamp: number,
    participants: Array<{ identity: string, name?: string }>
  ): SpeakerMapping | null {
    // Упрощенная логика: используем историю активных спикеров
    // В production нужно использовать более точный алгоритм на основе временных меток
    
    const existingMapping = this.speakerMappings.get(speakerId)
    if (existingMapping) {
      return existingMapping
    }

    // Если маппинга нет, создаем новый на основе первого доступного участника
    // В production нужно использовать более сложную логику
    if (participants.length > 0) {
      const mapping: SpeakerMapping = {
        speakerId,
        participantIdentity: participants[0].identity,
        participantName: participants[0].name,
        confidence: 0.5, // Низкая уверенность для начального маппинга
      }
      this.speakerMappings.set(speakerId, mapping)
      return mapping
    }

    return null
  }

  /**
   * Получает маппинг для speaker ID.
   */
  getMapping(speakerId: string): SpeakerMapping | undefined {
    return this.speakerMappings.get(speakerId)
  }

  /**
   * Останавливает отслеживание спикеров.
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    this.speakerMappings.clear()
    this.activeSpeakerHistory.clear()
    console.log(`[SpeakerMapper] Stopped speaker tracking for room ${this.sessionSlug}`)
  }
}


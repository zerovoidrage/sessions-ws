/**
 * Transcription Service - серверный сервис для транскрипции всех участников в комнате.
 * 
 * ПРИМЕЧАНИЕ: Это базовая структура. Полная реализация требует:
 * - LiveKit Client SDK для Node.js (с node-webrtc или альтернативой)
 * - Или использование LiveKit Egress API (для записи и последующей транскрипции)
 * - Или подход через WebRTC в Node.js окружении
 * 
 * Пока оставляем как архитектурную основу для будущей реализации.
 */

import { AccessToken } from 'livekit-server-sdk'
import { createGladiaBridge, type TranscriptEvent } from './gladia-bridge'
import { appendTranscriptChunk } from '../../src/modules/core/sessions/infra/transcription/appendTranscriptChunk'
import dotenv from 'dotenv'

dotenv.config()

interface TranscriptionServiceConfig {
  roomName: string
  sessionSlug: string
  serverUrl: string
  apiKey: string
  apiSecret: string
}

/**
 * Transcription Service - серверный сервис для транскрипции всех участников в комнате.
 * 
 * АРХИТЕКТУРА:
 * - Подключается к LiveKit room как "bot" subscriber
 * - Получает аудио-треки всех участников
 * - Миксит их в один поток и отправляет в Gladia для транскрипции
 * - Результаты транскрипции сохраняются в БД и отправляются клиентам через LiveKit data channel
 * 
 * TODO: Реализация требует настройки WebRTC в Node.js окружении.
 * Варианты:
 * 1. Использовать `livekit-client` с `node-webrtc` (сложно, но реально)
 * 2. Использовать LiveKit Egress API для записи аудио (не real-time, но проще)
 * 3. Временно оставить клиентскую транскрипцию (как сейчас работает)
 */
export class TranscriptionService {
  private gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  private config: TranscriptionServiceConfig
  private isActive = false
  // TODO: Добавить подключение к LiveKit room через WebSocket
  // private room: Room | null = null

  constructor(config: TranscriptionServiceConfig) {
    this.config = config
  }

  /**
   * Запускает транскрипцию для комнаты
   * 
   * TODO: Реализовать подключение к LiveKit room и получение аудио-потоков
   */
  async start(): Promise<void> {
    if (this.isActive) {
      console.log('[TranscriptionService] Already active, skipping start')
      return
    }

    console.log('[TranscriptionService] Starting transcription service', {
      roomName: this.config.roomName,
      sessionSlug: this.config.sessionSlug,
    })

    console.warn('[TranscriptionService] Server-side transcription not yet fully implemented')
    console.warn('[TranscriptionService] This requires WebRTC setup in Node.js environment')
    console.warn('[TranscriptionService] Current implementation uses client-side transcription')

    // TODO: Реализовать:
    // 1. Подключение к LiveKit room как bot через WebSocket
    // 2. Получение аудио-треков всех участников
    // 3. Микширование аудио
    // 4. Отправка в Gladia
    // 5. Получение транскриптов и отправка клиентам

    this.isActive = true
  }

  /**
   * Останавливает транскрипцию и очищает ресурсы
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return
    }

    console.log('[TranscriptionService] Stopping transcription service')

    // Закрываем Gladia bridge
    if (this.gladiaBridge) {
      this.gladiaBridge.close()
      this.gladiaBridge = null
    }

    // TODO: Отключиться от комнаты и очистить ресурсы

    this.isActive = false
    console.log('[TranscriptionService] Transcription service stopped')
  }

  /**
   * Генерирует LiveKit токен для bot-подключения
   */
  private async generateBotToken(): Promise<string> {
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: `transcription-bot-${this.config.sessionSlug}`,
      name: 'Transcription Bot',
    })

    at.addGrant({
      room: this.config.roomName,
      roomJoin: true,
      canPublish: false, // Bot только подписывается, не публикует
      canSubscribe: true,
    })

    return await at.toJwt()
  }

  /**
   * Обрабатывает транскрипт от Gladia
   * 
   * TODO: Реализовать отправку транскриптов клиентам через LiveKit data channel
   */
  private async handleTranscript(event: TranscriptEvent): Promise<void> {
    try {
      // TODO: Определить, какой участник сказал (нужна дополнительная информация от Gladia)
      // В микшированном потоке это сложно - нужно либо транскрибировать каждого отдельно,
      // либо использовать speaker diarization от Gladia

      // Сохраняем транскрипт в БД (только финальные)
      if (event.isFinal) {
        await appendTranscriptChunk({
          sessionSlug: this.config.sessionSlug,
          participantIdentity: 'unknown', // TODO: Определить участника
          utteranceId: event.utteranceId,
          text: event.text,
          isFinal: true,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
        })
      }

      // TODO: Отправить транскрипт клиентам через LiveKit data channel
      console.log('[TranscriptionService] Transcript received from Gladia', {
        text: event.text.substring(0, 50),
        isFinal: event.isFinal,
      })
    } catch (error) {
      console.error('[TranscriptionService] Error handling transcript:', error)
    }
  }
}


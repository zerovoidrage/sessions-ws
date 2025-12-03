/**
 * Gladia Live v2 WebSocket Bridge.
 * 
 * Обёртка над Gladia Live Realtime STT API для отправки PCM-аудио
 * и получения транскриптов в реальном времени.
 * 
 * Важно о diarization:
 * Gladia Live v2 не даёт полноценной diarization в real-time.
 * Diarization доступна только в file-based API (post-call analysis).
 * Поэтому speakerId из Gladia (если вдруг придёт) — второстепенный источник.
 * Главным считается active-speaker-tracker из LiveKit (локально на нашей стороне).
 * Логика в rtmp-ingest.ts правильно использует getActiveSpeaker(sessionSlug) как primary.
 */

import https from 'https'
import { WebSocket } from 'ws'
import dotenv from 'dotenv'

dotenv.config()

function getGladiaApiKey(): string {
  const key = process.env.GLADIA_API_KEY
  if (!key) {
    throw new Error('GLADIA_API_KEY is not set')
  }
  return key
}

export interface TranscriptEvent {
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
  speakerId?: string // Speaker ID от Gladia (если доступно, но обычно нет в Live v2)
  speakerName?: string // Имя спикера (если доступно)
  receivedAt?: number // Timestamp получения сообщения от Gladia (для дебага задержек)
}

export interface GladiaBridge {
  sendAudio(chunk: ArrayBuffer | Buffer): void
  close(): void
  onTranscript(cb: (event: TranscriptEvent) => void): void
}

/**
 * Тип для сообщений от Gladia Live v2 WebSocket.
 */
interface GladiaMessage {
  type: string
  data?: {
    id?: string
    is_final?: boolean
    utterance?: {
      text?: string
      speaker_id?: string
      speaker_name?: string
    }
    speaker_id?: string
    speaker_name?: string
  }
}

/**
 * Парсит сообщение от Gladia и извлекает транскрипт.
 * 
 * Следует актуальному формату Gladia Live v2:
 * - message.type === "transcript"
 * - message.data.utterance.text - текст транскрипта
 * - message.data.is_final - финальность
 * - message.data.id - ID utterance
 */
function parseTranscriptMessage(message: any): TranscriptEvent | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  // Проверяем тип сообщения
  if (message.type !== 'transcript' || !message.data) {
    return null
  }

  const data = message.data

  // Извлекаем данные из utterance
  if (!data.utterance || !data.utterance.text) {
    return null
  }

  const text = data.utterance.text.trim()
  if (!text) {
    return null
  }

  const isFinal = data.is_final === true
  const utteranceId = data.id || `gladia-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  // Извлекаем speaker ID (если доступно, хотя в Live v2 обычно нет)
  const speakerId = data.utterance.speaker_id || 
                   data.speaker_id || 
                   undefined

  const speakerName = data.utterance.speaker_name || 
                     data.speaker_name || 
                     (speakerId ? `Speaker ${speakerId}` : undefined)

  return {
    utteranceId,
    text,
    isFinal,
    startedAt: new Date(),
    endedAt: isFinal ? new Date() : undefined,
    speakerId,
    speakerName,
  }
}

export async function createGladiaBridge(): Promise<GladiaBridge> {
  const apiKey = getGladiaApiKey()
  
  // Инициализация сессии через POST /v2/live
  const websocketUrl = await initGladiaSession(apiKey)
  
  // Подключение к WebSocket
  const gladiaWs = new WebSocket(websocketUrl)
  
  let transcriptCallback: ((event: TranscriptEvent) => void) | null = null
  let isReady = false
  let isClosed = false
  
  gladiaWs.on('open', () => {
    console.log('[GladiaBridge] ✅ WebSocket connected to Gladia Live v2')
    isReady = true
  })
  
  gladiaWs.on('message', (data: Buffer | string) => {
    if (isClosed) {
      return // Игнорируем сообщения после закрытия
    }

    const messageReceivedAt = Date.now()

    try {
      const message: GladiaMessage = JSON.parse(data.toString())
      
      // Парсим транскрипты через helper
      const transcriptEvent = parseTranscriptMessage(message)
      
      if (transcriptEvent && transcriptCallback) {
        // Добавляем timestamp получения сообщения
        transcriptEvent.receivedAt = messageReceivedAt
        transcriptCallback(transcriptEvent)
        
        // Логируем получение транскрипта от Gladia (периодически)
        if (Math.random() < 0.1) { // 10% логов
          console.log('[GladiaBridge] Transcript received from Gladia', {
            utteranceId: transcriptEvent.utteranceId,
            isFinal: transcriptEvent.isFinal,
            textPreview: transcriptEvent.text.slice(0, 50),
            timestamp: messageReceivedAt,
          })
        }
      }
    } catch (error) {
      console.error('[GladiaBridge] Error parsing message:', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  
  gladiaWs.on('error', (error) => {
    console.error('[GladiaBridge] WebSocket error:', {
      error: error instanceof Error ? error.message : String(error),
      readyState: gladiaWs.readyState,
    })
    // Не бросаем ошибки наружу - Gladia WebSocket - смежный сервис
    // Приложение не должно падать из-за проблем с внешним сервисом
  })
  
  gladiaWs.on('close', (code, reason) => {
    console.log('[GladiaBridge] WebSocket closed', {
      code,
      reason: reason?.toString(),
      readyState: gladiaWs.readyState,
    })
    isReady = false
    isClosed = true
    // Не бросаем ошибки - это нормальное или неожиданное закрытие
    // Код должен быть готов к этому
  })
  
  return {
    sendAudio(chunk: ArrayBuffer | Buffer) {
      if (isClosed) {
        return
      }
      
      if (isReady && gladiaWs.readyState === WebSocket.OPEN) {
        try {
          const sendStartAt = Date.now()
          gladiaWs.send(chunk)
          const sendCompleteAt = Date.now()
          const sendLatency = sendCompleteAt - sendStartAt
          
          // Логируем задержку отправки (только периодически, чтобы не спамить)
          if (Math.random() < 0.01) { // 1% логов
            console.log('[GladiaBridge] Audio chunk sent', {
              chunkSize: Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength,
              sendLatencyMs: sendLatency,
              timestamp: sendCompleteAt,
            })
          }
        } catch (error) {
          console.error('[GladiaBridge] Error sending audio chunk:', {
            error: error instanceof Error ? error.message : String(error),
            chunkSize: Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength,
          })
        }
      }
    },
    close() {
      if (isClosed) {
        return
      }
      
      isClosed = true
      isReady = false
      
      if (gladiaWs.readyState === WebSocket.OPEN || gladiaWs.readyState === WebSocket.CONNECTING) {
        try {
          gladiaWs.close()
        } catch (error) {
          console.error('[GladiaBridge] Error closing WebSocket:', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      
      // Сбрасываем callback, чтобы не вызывать его после закрытия
      transcriptCallback = null
    },
    onTranscript(cb: (event: TranscriptEvent) => void) {
      // Аккуратно заменяем callback без накопления
      transcriptCallback = isClosed ? null : cb
    },
  }
}

/**
 * Инициализирует Gladia Live v2 сессию через POST /v2/live.
 * 
 * Возвращает WebSocket URL для отправки аудио и получения транскриптов.
 */
async function initGladiaSession(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      messages_config: {
        receive_partial_transcripts: true,
        receive_final_transcripts: true,
        receive_speech_events: false,
        receive_pre_processing_events: false,
        receive_realtime_processing_events: false,
        receive_post_processing_events: false,
        receive_acknowledgments: true,
        receive_errors: true,
        receive_lifecycle_events: false,
      },
      language_config: {
        languages: [], // Пустой массив = автоопределение языка
        code_switching: false,
      },
    })
    
    const options = {
      hostname: 'api.gladia.io',
      path: '/v2/live',
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 201 && res.statusCode !== 200) {
          console.error('[GladiaBridge] Failed to initialize Gladia session', {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            response: data.slice(0, 500),
          })
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} - ${data.slice(0, 200)}`))
          return
        }
        
        try {
          const response = JSON.parse(data)
          const websocketUrl = response.url || response.websocket_url
          
          if (websocketUrl) {
            console.log('[GladiaBridge] ✅ Gladia Live v2 session initialized', {
              websocketUrl: websocketUrl.replace(/\/\/.*@/, '//***@'), // Скрываем токен в URL
            })
            resolve(websocketUrl)
          } else {
            console.error('[GladiaBridge] No websocket_url in response', {
              response: data.slice(0, 500),
            })
            reject(new Error('No websocket_url in response'))
          }
        } catch (error) {
          console.error('[GladiaBridge] Failed to parse Gladia session response', {
            error: error instanceof Error ? error.message : String(error),
            response: data.slice(0, 500),
          })
          reject(error)
        }
      })
    })
    
    req.on('error', (error) => {
      console.error('[GladiaBridge] Error initializing Gladia session', {
        error: error.message,
      })
      reject(error)
    })
    
    req.setTimeout(10000, () => {
      console.error('[GladiaBridge] Timeout initializing Gladia session')
      req.destroy()
      reject(new Error('Timeout initializing Gladia session'))
    })
    
    req.write(postData)
    req.end()
  })
}

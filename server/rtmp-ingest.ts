/**
 * RTMP Ingest обработчик для одной сессии.
 * 
 * Архитектура:
 * LiveKit Room Composite Egress → RTMP → Глобальный RTMP Server → FFmpeg → PCM16 → Gladia
 * 
 * Преимущества:
 * - 1 Egress сессия на комнату (вместо N Track Egress)
 * - Микширование на стороне LiveKit (оптимизировано)
 * - Идеально для speaker diarization в Gladia
 */

import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import http from 'http'
import https from 'https'
import { getGlobalRTMPServer, startGlobalRTMPServer, type RTMPStreamHandler } from './rtmp-server.js'
import { createGladiaBridge, type TranscriptEvent } from './gladia-bridge.js'
import { broadcastToSessionClients } from './client-connection.js'
import { appendTranscriptChunk } from './append-transcript-chunk.js'
import { getActiveSpeaker } from './active-speaker-tracker.js'

export interface RTMPIngestConfig {
  rtmpPort?: number
  sessionId: string
  sessionSlug: string
}

export interface RTMPIngest extends EventEmitter {
  start(): Promise<void>
  stop(): Promise<void>
  isActive(): boolean
  startFFmpegNow(): Promise<void> // Публичный метод для запуска FFmpeg, если поток уже активен
}

/**
 * RTMP Ingest обработчик для одной сессии.
 * Использует глобальный RTMP сервер и FFmpeg для декодирования потока.
 */
class RTMPIngestImpl extends EventEmitter implements RTMPIngest {
  private ffmpegProcess: ReturnType<typeof spawn> | null = null
  private gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  private isActiveFlag = false
  private rtmpUrl: string
  private streamPath: string
  private streamHandler: RTMPStreamHandler
  private audioBytesSent = 0 // Счетчик байт для логирования
  private audioMetricsInterval: NodeJS.Timeout | null = null

  constructor(
    private config: RTMPIngestConfig
  ) {
    super()
    const rtmpPort = config.rtmpPort || parseInt(process.env.RTMP_PORT || '1937', 10)
    // ВАЖНО: FFmpeg всегда подключается к локальному RTMP серверу (localhost)
    // Egress подключается к внешнему URL через TCP прокси, который проксируется на локальный порт
    const rtmpHost = 'localhost'
    this.streamPath = `/live/${config.sessionSlug}`
    this.rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}${this.streamPath}`
    
    // Обработчик потока для глобального RTMP сервера
    this.streamHandler = {
      onStreamStart: (streamPath: string) => {
        console.log(`[RTMPIngest] ✅ LiveKit Egress connected to RTMP stream: ${streamPath}`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
        })
        
        // Запускаем FFmpeg только когда поток реально начался
        // Защита от повторного запуска (idempotent)
        if (!this.ffmpegProcess) {
          this.startFFmpegDecoder().catch((error) => {
            console.error(`[RTMPIngest] Failed to start FFmpeg decoder for session ${this.config.sessionId}:`, error)
            // Не падаем - просто логируем, транскрипция не будет работать
          })
        } else {
          console.warn(`[RTMPIngest] FFmpeg already running for stream ${streamPath}, session ${this.config.sessionId}`)
        }
      },
      onStreamData: (streamPath: string, data: Buffer) => {
        // Данные обрабатываются через FFmpeg, не напрямую
      },
      onStreamEnd: (streamPath: string) => {
        console.log(`[RTMPIngest] RTMP stream ended: ${streamPath}`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
        })
        
        // Корректное завершение при окончании потока
        this.stopFFmpegDecoder()
        
        if (this.gladiaBridge) {
          this.gladiaBridge.close()
          this.gladiaBridge = null
        }
        
        this.stopAudioMetrics()
        
        console.log(`[RTMPIngest] ✅ Stream cleanup completed for session ${this.config.sessionId}`)
      },
    }
  }

  async start(): Promise<void> {
    if (this.isActiveFlag) {
      console.warn(`[RTMPIngest] Already active for session ${this.config.sessionId}`)
      return
    }

    console.log(`[RTMPIngest] Starting RTMP Ingest for session ${this.config.sessionId}`, {
      sessionSlug: this.config.sessionSlug,
      streamPath: this.streamPath,
      rtmpUrl: this.rtmpUrl,
    })

    try {
      // 1. Запускаем глобальный RTMP сервер (если еще не запущен)
      await startGlobalRTMPServer()

      // 2. Регистрируем обработчик потока в глобальном RTMP сервере
      const rtmpServer = getGlobalRTMPServer()
      rtmpServer.registerStreamHandler(this.streamPath, this.streamHandler)

      // 3. Инициализируем Gladia bridge
      // Gladia bridge создается сразу, но WebSocket подключится автоматически
      this.gladiaBridge = await createGladiaBridge()
      this.gladiaBridge.onTranscript((event) => this.handleTranscript(event))

      // 4. FFmpeg будет запущен только когда LiveKit Egress подключится (в onStreamStart)
      // Не запускаем его здесь - ждем реального RTMP потока

      this.isActiveFlag = true
      console.log(`[RTMPIngest] ✅ RTMP Ingest initialized for session ${this.config.sessionId}`, {
        sessionSlug: this.config.sessionSlug,
        rtmpUrl: this.rtmpUrl,
        waitingForEgress: true,
      })
    } catch (error) {
      console.error(`[RTMPIngest] Failed to start for session ${this.config.sessionId}:`, error)
      await this.stop()
      throw error
    }
  }

  private async startFFmpegDecoder(): Promise<void> {
    // Идемпотентная проверка - защита от повторного запуска
    if (this.ffmpegProcess) {
      console.warn(`[RTMPIngest] FFmpeg decoder already running for session ${this.config.sessionId}`)
      return
    }

    // Проверяем наличие FFmpeg перед запуском
    try {
      const { execSync } = await import('child_process')
      execSync('which ffmpeg', { stdio: 'ignore' })
    } catch (error) {
      const errorMsg = 'FFmpeg not found in PATH. Transcription will not work.'
      console.error(`[RTMPIngest] ⚠️ ${errorMsg}`, {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
      })
      // Не бросаем ошибку - делаем мягкое завершение
      return
    }

    // FFmpeg команда для декодирования RTMP → PCM16 16kHz mono
    // Агрессивные low-latency флаги для минимизации буферизации
    const ffmpegArgs = [
      // Ultra-low-latency флаги для RTMP
      '-fflags', 'nobuffer', // Отключаем буферизацию
      '-flags', 'low_delay', // Минимальная задержка
      '-rtmp_live', 'live', // Режим live streaming
      '-probesize', '32', // Минимальный размер probe (быстрый старт)
      '-analyzeduration', '0', // Не анализировать поток заранее
      // Reconnect флаги для стабильности
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      // Вход
      '-i', this.rtmpUrl, // Вход: RTMP поток
      // Аудио декодирование
      '-vn', // Отключаем видео
      '-acodec', 'pcm_s16le', // PCM16 little-endian
      '-ar', '16000', // Sample rate 16kHz
      '-ac', '1', // Моно
      '-f', 's16le', // Формат: raw PCM16
      'pipe:1', // Вывод в stdout
    ]

    console.log(`[RTMPIngest] Starting FFmpeg decoder for session ${this.config.sessionId}`, {
      sessionSlug: this.config.sessionSlug,
      streamPath: this.streamPath,
      command: `ffmpeg ${ffmpegArgs.join(' ')}`,
    })

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'], // stdin: ignore, stdout: pipe, stderr: pipe
    })

    if (!this.ffmpegProcess.stdout || !this.ffmpegProcess.stderr) {
      console.error(`[RTMPIngest] FFmpeg process stdout/stderr is not available`, {
        sessionId: this.config.sessionId,
      })
      this.ffmpegProcess = null
      return
    }

    // Сбрасываем счетчик метрик
    this.audioBytesSent = 0
    this.startAudioMetrics()

    // Размер чанка для оптимальной задержки: ~100-200ms аудио
    // PCM16, 16kHz, mono = 2 байта на сэмпл
    // 100ms = 0.1s * 16000 samples/s * 2 bytes = 3200 bytes
    // 200ms = 0.2s * 16000 samples/s * 2 bytes = 6400 bytes
    const OPTIMAL_CHUNK_SIZE = 3200 // ~100ms аудио для минимальной задержки
    let audioBuffer = Buffer.alloc(0)

    this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      // Получаем PCM16 данные и отправляем в Gladia мелкими чанками
      if (this.gladiaBridge && chunk.length > 0) {
        this.audioBytesSent += chunk.length
        
        // Накапливаем данные в буфере
        audioBuffer = Buffer.concat([audioBuffer, chunk])
        
        // Отправляем чанки оптимального размера для минимальной задержки
        while (audioBuffer.length >= OPTIMAL_CHUNK_SIZE) {
          const chunkToSend = audioBuffer.slice(0, OPTIMAL_CHUNK_SIZE)
          audioBuffer = audioBuffer.slice(OPTIMAL_CHUNK_SIZE)
          
          const timestamp = Date.now()
          this.gladiaBridge.sendAudio(chunkToSend)
          
          // Логируем отправку чанка (только периодически, чтобы не спамить)
          if (Math.random() < 0.01) { // 1% логов
            console.log('[RTMPIngest] Audio chunk sent to Gladia', {
              sessionSlug: this.config.sessionSlug,
              chunkSize: chunkToSend.length,
              timestamp,
              audioDurationMs: (chunkToSend.length / 2 / 16000) * 1000, // bytes / 2 / sampleRate * 1000
            })
          }
        }
      }
    })

    this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
      // Логируем сообщения FFmpeg
      const message = data.toString()
      // FFmpeg пишет в stderr даже обычные сообщения
      if (message.includes('Stream #0') || message.includes('Audio:')) {
        console.log(`[RTMPIngest] FFmpeg info:`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          message: message.trim(),
        })
      } else if (message.includes('error') || message.includes('Error') || message.includes('failed')) {
        console.error(`[RTMPIngest] FFmpeg error:`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          message: message.trim(),
        })
      }
    })

    this.ffmpegProcess.on('error', (error) => {
      console.error(`[RTMPIngest] FFmpeg process error:`, {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
        error: error.message,
        code: (error as any).code,
      })
      
      // Мягкая обработка ошибок - не падаем
      if (error.message.includes('ENOENT') || (error as any).code === 'ENOENT') {
        console.error(`[RTMPIngest] ⚠️ FFmpeg not found. Transcription will not work.`, {
          sessionId: this.config.sessionId,
        })
      }
      
      // Очищаем процесс
      this.ffmpegProcess = null
      this.stopAudioMetrics()
      // Не бросаем ошибку - позволяем приложению продолжать работать
    })

    this.ffmpegProcess.on('exit', (code, signal) => {
      console.log(`[RTMPIngest] FFmpeg process exited`, {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
        exitCode: code,
        signal: signal,
        // Коды выхода FFmpeg:
        // 0 = успешное завершение
        // 1 = ошибка
        // 255 = прервано пользователем или разрыв соединения (может быть нормальным)
      })
      
      this.ffmpegProcess = null
      this.stopAudioMetrics()
      
      // Логируем ошибку только если это не нормальное завершение
      if (code !== 0 && code !== null && code !== 255) {
        console.error(`[RTMPIngest] FFmpeg exited with error code ${code}`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
        })
        this.emit('error', new Error(`FFmpeg exited with code ${code}`))
      }
    })
  }

  private stopFFmpegDecoder(): void {
    if (this.ffmpegProcess) {
      console.log(`[RTMPIngest] Stopping FFmpeg decoder`, {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
      })
      
      // Пытаемся корректно завершить процесс
      try {
        this.ffmpegProcess.kill('SIGTERM')
        
        // Если процесс не завершился за 3 секунды, убиваем принудительно
        setTimeout(() => {
          if (this.ffmpegProcess) {
            console.warn(`[RTMPIngest] FFmpeg process did not terminate, killing with SIGKILL`, {
              sessionId: this.config.sessionId,
            })
            this.ffmpegProcess.kill('SIGKILL')
          }
        }, 3000)
      } catch (error) {
        console.error(`[RTMPIngest] Error stopping FFmpeg:`, {
          sessionId: this.config.sessionId,
          error,
        })
      }
      
      this.ffmpegProcess = null
      this.stopAudioMetrics()
    }
  }

  private startAudioMetrics(): void {
    // Очищаем предыдущий интервал, если есть
    this.stopAudioMetrics()
    
    // Логируем метрики каждые 10 секунд
    this.audioMetricsInterval = setInterval(() => {
      if (this.audioBytesSent > 0) {
        const mbSent = (this.audioBytesSent / (1024 * 1024)).toFixed(2)
        console.log(`[RTMPIngest] Audio metrics`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          bytesSent: this.audioBytesSent,
          mbSent: `${mbSent} MB`,
        })
      }
    }, 10000) // Каждые 10 секунд
  }

  private stopAudioMetrics(): void {
    if (this.audioMetricsInterval) {
      clearInterval(this.audioMetricsInterval)
      this.audioMetricsInterval = null
    }
  }

  private async sendTranscriptToWebSocketServer(
    sessionSlug: string,
    broadcastBody: {
      sessionSlug: string
      utteranceId: string
      text: string
      isFinal: boolean
      speaker?: string
      speakerId?: string
      ts?: number
    }
  ): Promise<void> {
    // Определяем URL WebSocket сервера для broadcast
    const wsBaseUrl = process.env.WS_BASE_URL || process.env.WS_SERVER_URL
    
    if (!wsBaseUrl) {
      // Fallback: in-memory broadcast (если оба сервиса в одном процессе)
      console.log('[RTMPIngest] WS_BASE_URL not set, using in-memory broadcast', {
        sessionSlug,
        sessionId: this.config.sessionId,
      })
      
      const payload: any = {
        type: 'transcript',
        sessionSlug: broadcastBody.sessionSlug,
        utteranceId: broadcastBody.utteranceId,
        text: broadcastBody.text,
        isFinal: broadcastBody.isFinal,
        speaker: broadcastBody.speaker,
        speakerId: broadcastBody.speakerId,
        ts: broadcastBody.ts,
      }
      
      broadcastToSessionClients(sessionSlug, payload)
      return
    }

    const postData = JSON.stringify(broadcastBody)
    const httpRequestStartAt = Date.now()

    try {
      const url = new URL(wsBaseUrl)
      const broadcastPath = '/api/realtime/transcribe/broadcast'
      
      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
        path: broadcastPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }

      // Используем правильный модуль в зависимости от протокола
      const httpModule = url.protocol === 'https:' ? https : http

      return new Promise<void>((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
          const httpResponseReceivedAt = Date.now()
          const httpLatency = httpResponseReceivedAt - httpRequestStartAt
          let responseData = ''
          res.on('data', (chunk) => {
            responseData += chunk.toString()
          })

          res.on('end', () => {
            const httpRequestCompleteAt = Date.now()
            const totalHttpLatency = httpRequestCompleteAt - httpRequestStartAt
            
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(responseData)
                console.log('[RTMPIngest] ✅ Transcript posted to WS broadcast', {
                  sessionSlug,
                  sessionId: this.config.sessionId,
                  status: res.statusCode,
                  sent: response.sent || 0,
                  textPreview: broadcastBody.text.slice(0, 80),
                  httpLatencyMs: totalHttpLatency,
                  timestamp: httpRequestCompleteAt,
                })
                resolve()
              } catch (parseError) {
                console.warn('[RTMPIngest] Failed to parse broadcast response (but status was 200)', {
                  sessionSlug,
                  sessionId: this.config.sessionId,
                  responseData: responseData.slice(0, 200),
                })
                resolve() // Все равно считаем успешным, если статус 200
              }
            } else {
              console.error('[RTMPIngest] ❌ Failed to post transcript to WS broadcast', {
                sessionSlug,
                sessionId: this.config.sessionId,
                hostname: url.hostname,
                path: broadcastPath,
                statusCode: res.statusCode,
                statusText: res.statusMessage,
                responsePreview: responseData.slice(0, 200),
                textPreview: broadcastBody.text.slice(0, 80),
              })
              // Не бросаем ошибку - просто логируем (fail-soft)
              resolve()
            }
          })
        })

        req.on('error', (error) => {
          console.error('[RTMPIngest] ❌ Error posting transcript to WS broadcast', {
            sessionSlug,
            sessionId: this.config.sessionId,
            hostname: url.hostname,
            path: broadcastPath,
            error: error.message,
            textPreview: broadcastBody.text.slice(0, 80),
          })
          // Не бросаем ошибку - просто логируем (fail-soft)
          resolve()
        })

        req.setTimeout(5000, () => {
          console.error('[RTMPIngest] ❌ Timeout posting transcript to WS broadcast', {
            sessionSlug,
            sessionId: this.config.sessionId,
            hostname: url.hostname,
            path: broadcastPath,
          })
          req.destroy()
          resolve() // Fail-soft
        })

        req.write(postData)
        req.end()
      })
    } catch (error: any) {
      console.error('[RTMPIngest] ❌ Failed to post transcript to WS broadcast (parse error)', {
        sessionSlug,
        sessionId: this.config.sessionId,
        wsBaseUrl,
        error: error.message,
        textPreview: broadcastBody.text.slice(0, 80),
      })
      // Не бросаем ошибку - просто логируем (fail-soft)
    }
  }

  private handleTranscript(event: TranscriptEvent): void {
    if (!this.gladiaBridge) return

    const transcriptReceivedAt = Date.now()

    // Получаем текущего активного спикера для этой сессии
    // active-speaker-tracker из LiveKit - основной источник
    // event.speakerId от Gladia - fallback (Gladia Live v2 не дает полноценной diarization)
    const activeSpeaker = getActiveSpeaker(this.config.sessionSlug)
    const speakerIdentity = activeSpeaker?.identity || event.speakerId || 'room'
    const speakerName = activeSpeaker?.name || event.speakerName || 'Meeting'

    // Логируем получение транскрипта от Gladia с timestamp
    console.log('[RTMPIngest] Received transcript from Gladia', {
      sessionId: this.config.sessionId,
      sessionSlug: this.config.sessionSlug,
      textPreview: event.text.slice(0, 80),
      isFinal: event.isFinal,
      utteranceId: event.utteranceId,
      speakerIdentity,
      speakerName,
      gladiaSpeakerId: event.speakerId,
      timestamp: transcriptReceivedAt,
      timestampISO: new Date(transcriptReceivedAt).toISOString(),
    })

    // Формируем payload для broadcast endpoint
    const broadcastBody = {
      sessionSlug: this.config.sessionSlug,
      utteranceId: event.utteranceId,
      text: event.text,
      isFinal: event.isFinal,
      speaker: speakerIdentity,
      speakerId: speakerIdentity,
      ts: Date.now(),
    }

    // Отправляем транскрипт в WebSocket сервер через HTTP broadcast endpoint
    const sendStartAt = Date.now()
    this.sendTranscriptToWebSocketServer(this.config.sessionSlug, broadcastBody)
      .then(() => {
        const sendCompleteAt = Date.now()
        const sendLatency = sendCompleteAt - sendStartAt
        const totalLatency = sendCompleteAt - transcriptReceivedAt
        
        // Логируем задержку доставки (только для финальных транскриптов или периодически)
        if (event.isFinal || Math.random() < 0.1) { // 10% логов для interim
          console.log('[RTMPIngest] Transcript delivery latency', {
            sessionSlug: this.config.sessionSlug,
            isFinal: event.isFinal,
            httpLatencyMs: sendLatency,
            totalLatencyFromGladiaMs: totalLatency,
            textPreview: event.text.slice(0, 50),
          })
        }
      })
      .catch((error) => {
        console.error('[RTMPIngest] Failed to post transcript to WS broadcast (in catch)', {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          error,
          textPreview: event.text.slice(0, 80),
          timestamp: Date.now(),
        })
      })

    // Сохраняем финальные транскрипты в БД
    if (event.isFinal) {
      appendTranscriptChunk({
        sessionSlug: this.config.sessionSlug,
        participantIdentity: speakerIdentity !== 'room' ? speakerIdentity : undefined,
        utteranceId: event.utteranceId,
        text: event.text,
        isFinal: true,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        sessionId: this.config.sessionId,
      }).catch((error) => {
        console.error('[RTMPIngest] Failed to append transcript chunk:', {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          error,
        })
      })
    }
  }

  async stop(): Promise<void> {
    if (!this.isActiveFlag) {
      return
    }

    console.log(`[RTMPIngest] Stopping RTMP Ingest for session ${this.config.sessionId}`, {
      sessionSlug: this.config.sessionSlug,
    })

    // 1. Удаляем обработчик потока из глобального RTMP сервера
    try {
      const rtmpServer = getGlobalRTMPServer()
      rtmpServer.unregisterStreamHandler(this.streamPath)
    } catch (error) {
      console.error(`[RTMPIngest] Error unregistering stream handler:`, {
        sessionId: this.config.sessionId,
        error,
      })
    }

    // 2. Останавливаем FFmpeg
    this.stopFFmpegDecoder()

    // 3. Закрываем Gladia bridge
    if (this.gladiaBridge) {
      try {
        this.gladiaBridge.close()
      } catch (error) {
        console.error(`[RTMPIngest] Error closing Gladia bridge:`, {
          sessionId: this.config.sessionId,
          error,
        })
      }
      this.gladiaBridge = null
    }

    // 4. Останавливаем метрики
    this.stopAudioMetrics()

    // 5. Сбрасываем флаг активности
    this.isActiveFlag = false
    
    console.log(`[RTMPIngest] ✅ RTMP Ingest stopped for session ${this.config.sessionId}`, {
      sessionSlug: this.config.sessionSlug,
    })
  }

  async startFFmpegNow(): Promise<void> {
    // Публичный метод для запуска FFmpeg, если поток уже активен
    // Используется при автоматическом создании RTMPIngest, когда поток уже начался
    if (!this.gladiaBridge) {
      console.warn(`[RTMPIngest] Cannot start FFmpeg: Gladia bridge not initialized`, {
        sessionId: this.config.sessionId,
      })
      return
    }
    
    await this.startFFmpegDecoder()
  }

  isActive(): boolean {
    return this.isActiveFlag
  }

  getRTMPUrl(): string {
    return this.rtmpUrl
  }
}

/**
 * Создает RTMP Ingest для сессии.
 */
export async function createRTMPIngest(
  config: RTMPIngestConfig
): Promise<RTMPIngest> {
  const ingest = new RTMPIngestImpl(config)
  await ingest.start()
  return ingest
}

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

export interface RTMPIngestConfig {
  rtmpPort?: number
  sessionId: string
  sessionSlug: string
}

export interface RTMPIngest extends EventEmitter {
  start(): Promise<void>
  stop(): Promise<void>
  isActive(): boolean
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

  constructor(
    private config: RTMPIngestConfig
  ) {
    super()
    const rtmpPort = config.rtmpPort || 1935
    const rtmpHost = process.env.RTMP_HOST || 'localhost'
    this.streamPath = `/live/${config.sessionSlug}`
    this.rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}${this.streamPath}`
    
    // Обработчик потока для глобального RTMP сервера
    // FFmpeg запускается сразу при старте ingest, но будет ждать подключения потока
    this.streamHandler = {
      onStreamStart: (streamPath: string) => {
        console.log(`[RTMPIngest] ✅ Stream started: ${streamPath} for session ${this.config.sessionId}`)
        // FFmpeg уже запущен и будет автоматически подключиться к потоку
      },
      onStreamData: (streamPath: string, data: Buffer) => {
        // Данные обрабатываются через FFmpeg, не напрямую
      },
      onStreamEnd: (streamPath: string) => {
        console.log(`[RTMPIngest] Stream ended: ${streamPath} for session ${this.config.sessionId}`)
        // FFmpeg автоматически завершится при разрыве соединения
      },
    }
  }

  async start(): Promise<void> {
    if (this.isActiveFlag) {
      console.warn(`[RTMPIngest] Already active for session ${this.config.sessionId}`)
      return
    }

    try {
      // 1. Запускаем глобальный RTMP сервер (если еще не запущен)
      // RTMP сервер нужен для приема потока от Egress
      await startGlobalRTMPServer()

      // 2. Регистрируем обработчик потока в глобальном RTMP сервере
      const rtmpServer = getGlobalRTMPServer()
      rtmpServer.registerStreamHandler(this.streamPath, this.streamHandler)

      // 3. Инициализируем Gladia bridge
      this.gladiaBridge = await createGladiaBridge()
      this.gladiaBridge.onTranscript((event) => this.handleTranscript(event))

      // 4. Запускаем FFmpeg для приема RTMP потока (будет ждать подключения Egress)
      // FFmpeg будет пытаться подключиться к RTMP потоку
      // Когда Egress начнет стримить, FFmpeg автоматически подключится
      await this.startFFmpegDecoder()

      this.isActiveFlag = true
      console.log(`[RTMPIngest] ✅ Started for session ${this.config.sessionId}, RTMP URL: ${this.rtmpUrl}`)
      console.log(`[RTMPIngest] Waiting for Egress to connect to: ${this.rtmpUrl}`)
    } catch (error) {
      console.error(`[RTMPIngest] Failed to start for session ${this.config.sessionId}:`, error)
      await this.stop()
      throw error
    }
  }

  private async startFFmpegDecoder(): Promise<void> {
    if (this.ffmpegProcess) {
      console.warn(`[RTMPIngest] FFmpeg decoder already running for session ${this.config.sessionId}`)
      return
    }

    // FFmpeg команда для декодирования RTMP → PCM16 16kHz mono
    // ВАЖНО: FFmpeg должен быть установлен в системе
    // Используем параметры для ожидания подключения потока
    const ffmpegArgs = [
      '-rtmp_live', 'live', // Режим live streaming
      '-i', this.rtmpUrl, // Вход: RTMP поток
      '-vn', // Отключаем видео
      '-acodec', 'pcm_s16le', // PCM16 little-endian
      '-ar', '16000', // Sample rate 16kHz
      '-ac', '1', // Моно
      '-f', 's16le', // Формат: raw PCM16
      'pipe:1', // Вывод в stdout
    ]

    console.log(`[RTMPIngest] Starting FFmpeg decoder for session ${this.config.sessionId}`)
    console.log(`[RTMPIngest] FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`)

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'], // stdin: ignore, stdout: pipe, stderr: pipe
    })

    if (!this.ffmpegProcess.stdout || !this.ffmpegProcess.stderr) {
      throw new Error('FFmpeg process stdout/stderr is not available')
    }

    this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      // Получаем PCM16 данные и отправляем в Gladia
      if (this.gladiaBridge && chunk.length > 0) {
        this.gladiaBridge.sendAudio(chunk)
      }
    })

    this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
      // Логируем сообщения FFmpeg
      const message = data.toString()
      // FFmpeg пишет в stderr даже обычные сообщения
      if (message.includes('Stream #0') || message.includes('Audio:')) {
        console.log(`[RTMPIngest] FFmpeg info:`, message.trim())
      } else if (message.includes('error') || message.includes('Error') || message.includes('failed')) {
        console.error(`[RTMPIngest] FFmpeg error:`, message.trim())
      }
    })

    this.ffmpegProcess.on('error', (error) => {
      console.error(`[RTMPIngest] FFmpeg process error:`, error)
      // Проверяем, установлен ли FFmpeg
      if (error.message.includes('ENOENT')) {
        console.error(`[RTMPIngest] FFmpeg not found. Please install FFmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)`)
      }
      this.emit('error', error)
    })

    this.ffmpegProcess.on('exit', (code, signal) => {
      console.log(`[RTMPIngest] FFmpeg process exited for session ${this.config.sessionId}: code=${code}, signal=${signal}`)
      this.ffmpegProcess = null
      // Коды выхода FFmpeg:
      // 0 = успешное завершение
      // 1 = ошибка
      // 255 = прервано пользователем или разрыв соединения (может быть нормальным)
      if (code !== 0 && code !== null && code !== 255) {
        console.error(`[RTMPIngest] FFmpeg exited with error code ${code}`)
        this.emit('error', new Error(`FFmpeg exited with code ${code}`))
      }
    })
  }

  private stopFFmpegDecoder(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM')
      this.ffmpegProcess = null
    }
  }

  private handleTranscript(event: TranscriptEvent): void {
    if (!this.gladiaBridge) return

    const broadcastBody = {
      sessionSlug: this.config.sessionSlug,
      utteranceId: event.utteranceId,
      text: event.text,
      isFinal: event.isFinal,
      speaker: event.speakerName || 'Meeting',
      speakerId: event.speakerId || 'room',
      ts: Date.now(),
    }

    // 1. Отправляем транскрипт через WebSocket сервер (split services) или in-memory (single process)
    this.sendTranscriptToWebSocketServer(this.config.sessionSlug, broadcastBody).catch((error) => {
      console.error('[RTMPIngest] Failed to send transcript to WebSocket server:', error)
    })

    // 2. Сохраняем финальные транскрипты в БД
    if (event.isFinal) {
      appendTranscriptChunk({
        sessionSlug: this.config.sessionSlug,
        participantIdentity: event.speakerId ? `speaker_${event.speakerId}` : undefined,
        utteranceId: event.utteranceId,
        text: event.text,
        isFinal: true,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        sessionId: this.config.sessionId,
      }).catch((error) => {
        console.error('[RTMPIngest] Failed to append transcript chunk:', error)
      })
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
        type: 'transcription',
        sessionSlug: broadcastBody.sessionSlug,
        utteranceId: broadcastBody.utteranceId,
        text: broadcastBody.text,
        isFinal: broadcastBody.isFinal,
        speaker: broadcastBody.speaker,
        speakerId: broadcastBody.speakerId,
        ts: broadcastBody.ts,
      }
      
      broadcastToSessionClients(this.config.sessionId, payload)
      return
    }

    const postData = JSON.stringify(broadcastBody)

    try {
      const url = new URL(wsBaseUrl)
      const broadcastPath = '/api/realtime/transcribe/broadcast'
      
      // Используем https для HTTPS URL, http для HTTP URL
      const requestModule = url.protocol === 'https:' ? https : http

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

      return new Promise<void>((resolve, reject) => {
        const req = requestModule.request(options, (res) => {
          let responseData = ''
          res.on('data', (chunk) => {
            responseData += chunk.toString()
          })

          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(responseData)
                console.log('[RTMPIngest] ✅ Transcript posted to WS broadcast', {
                  sessionSlug,
                  sessionId: this.config.sessionId,
                  status: res.statusCode,
                  sent: response.sent || 0,
                  textPreview: broadcastBody.text.slice(0, 80),
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
                statusCode: res.statusCode,
                responseData: responseData.slice(0, 200),
              })
              reject(new Error(`HTTP ${res.statusCode}: ${responseData.slice(0, 100)}`))
            }
          })
        })

        req.on('error', (error) => {
          console.error('[RTMPIngest] ❌ Error posting transcript to WS broadcast', {
            sessionSlug,
            sessionId: this.config.sessionId,
            hostname: url.hostname,
            error: error.message,
          })
          reject(error)
        })

        // Таймаут для запроса (10 секунд)
        req.setTimeout(10000, () => {
          req.destroy()
          reject(new Error('Request timeout'))
        })

        req.write(postData)
        req.end()
      })
    } catch (error: any) {
      console.error('[RTMPIngest] ❌ Failed to send transcript to WebSocket server', {
        sessionSlug,
        sessionId: this.config.sessionId,
        wsBaseUrl,
        error: error.message,
      })
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isActiveFlag) {
      return
    }

    console.log(`[RTMPIngest] Stopping for session ${this.config.sessionId}`)

    // Удаляем обработчик потока из глобального RTMP сервера
    const rtmpServer = getGlobalRTMPServer()
    rtmpServer.unregisterStreamHandler(this.streamPath)

    // Останавливаем FFmpeg
    this.stopFFmpegDecoder()

    // Закрываем Gladia bridge
    if (this.gladiaBridge) {
      this.gladiaBridge.close()
      this.gladiaBridge = null
    }

    this.isActiveFlag = false
    console.log(`[RTMPIngest] ✅ Stopped for session ${this.config.sessionId}`)
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


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
import { recordLatency, recordCounter } from './realtime-metrics.js'

/**
 * Режим broadcast транскриптов:
 * - 'direct' (по умолчанию): прямой in-memory WS broadcast (минимальная задержка)
 * - 'http': через HTTP POST на WS сервер (fallback/интеграционный режим)
 */
const REALTIME_BROADCAST_MODE =
  process.env.REALTIME_BROADCAST_MODE?.toLowerCase() === 'http'
    ? 'http'
    : 'direct'

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
  // Состояние для ретраев FFmpeg
  private ffmpegRestartAttempts = 0
  private readonly MAX_FFMPEG_RESTARTS = 3
  private ffmpegStderrLines: string[] = []
  // Телеметрия для точного отслеживания задержек
  private lastAudioChunkSentAt: number | null = null
  private lastTranscriptReceivedAt: number | null = null

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

    // При новом запуске сбрасываем только накопленные строки stderr
    // Счетчик попыток сбрасываем только если это первый запуск (не ретрай)
    // Если это ретрай, счетчик уже был увеличен в обработчике exit
    if (this.ffmpegRestartAttempts === 0) {
      // Это первый запуск, сбрасываем stderr
      this.ffmpegStderrLines = []
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
    // Low-latency флаги для минимизации буферизации (умеренные, чтобы не ломать RTMP)
    const ffmpegArgs = [
      // Low-latency флаги для RTMP
      '-fflags', 'nobuffer', // Отключаем буферизацию
      '-flags', 'low_delay', // Минимальная задержка
      '-rtmp_live', 'live', // Режим live streaming
      // Чуть более безопасные значения анализа потока
      '-probesize', '4096', // вместо 32 — всё ещё low latency, но стабильнее
      '-analyzeduration', '100000', // ~100ms анализа
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
    
    // Если FFmpeg успешно запустился и начал работать, сбрасываем счетчик попыток
    // Это будет сделано после того, как FFmpeg начнет выдавать данные

    // Размер чанка для оптимальной задержки: ~100-200ms аудио
    // PCM16, 16kHz, mono = 2 байта на сэмпл
    // 100ms = 0.1s * 16000 samples/s * 2 bytes = 3200 bytes
    // 200ms = 0.2s * 16000 samples/s * 2 bytes = 6400 bytes
    const OPTIMAL_CHUNK_SIZE = 3200 // ~100ms аудио для минимальной задержки
    let audioBuffer = Buffer.alloc(0)
    let lastFlushTime = Date.now()
    const FLUSH_INTERVAL_MS = 50 // Отправляем остатки каждые 50ms

    // Флаг для отслеживания успешного старта FFmpeg
    let ffmpegStartedSuccessfully = false
    
    this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      // Если FFmpeg начал выдавать данные - значит он успешно запустился
      if (!ffmpegStartedSuccessfully && chunk.length > 0) {
        ffmpegStartedSuccessfully = true
        // Сбрасываем счетчик попыток при успешном запуске
        this.ffmpegRestartAttempts = 0
        console.log(`[RTMPIngest] FFmpeg started successfully, resetting restart attempts`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
        })
      }
      
      // Получаем PCM16 данные и отправляем в Gladia мелкими чанками
      if (this.gladiaBridge && chunk.length > 0) {
        this.audioBytesSent += chunk.length
        
        // Накапливаем данные в буфере
        audioBuffer = Buffer.concat([audioBuffer, chunk])
        
        const now = Date.now()
        const shouldFlush = (now - lastFlushTime) >= FLUSH_INTERVAL_MS
        
        // Отправляем чанки оптимального размера для минимальной задержки
        while (audioBuffer.length >= OPTIMAL_CHUNK_SIZE) {
          const chunkToSend = audioBuffer.slice(0, OPTIMAL_CHUNK_SIZE)
          audioBuffer = audioBuffer.slice(OPTIMAL_CHUNK_SIZE)
          
          // Телеметрия: отслеживание отправки аудио чанков
          const sendTs = Date.now()
          this.lastAudioChunkSentAt = sendTs
          recordCounter('audio.chunks_sent')
          recordLatency('audio.chunk_size_bytes', chunkToSend.length)
          
          // Логируем отправку аудио чанка (периодически для метрик)
          if (Math.random() < 0.01) { // 1% логов
            console.log('[RTMPIngest] 🎤 Audio chunk sent to Gladia', {
              sessionSlug: this.config.sessionSlug,
              chunkSize: chunkToSend.length,
              audioDurationMs: (chunkToSend.length / 2 / 16000) * 1000, // bytes / 2 / sampleRate * 1000
              timestamp: sendTs,
              timestampISO: new Date(sendTs).toISOString(),
            })
          }
          
          this.gladiaBridge.sendAudio(chunkToSend)
          lastFlushTime = now
        }
        
        // Отправляем остатки если прошло достаточно времени (чтобы не накапливались)
        if (shouldFlush && audioBuffer.length > 0) {
          // Телеметрия: отслеживание отправки остатков буфера
          const sendTs = Date.now()
          this.lastAudioChunkSentAt = sendTs
          recordCounter('audio.chunks_sent')
          recordLatency('audio.chunk_size_bytes', audioBuffer.length)
          
          this.gladiaBridge.sendAudio(audioBuffer)
          audioBuffer = Buffer.alloc(0)
          lastFlushTime = now
        }
      }
    })

    this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
      // Логируем сообщения FFmpeg
      const message = data.toString()
      
      // Копим последние 10 строк stderr для дебага
      const lines = message.split('\n').map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        this.ffmpegStderrLines.push(line)
        if (this.ffmpegStderrLines.length > 10) {
          this.ffmpegStderrLines.shift()
        }
      }
      
      // FFmpeg пишет в stderr даже обычные сообщения
      if (message.includes('Stream #0') || message.includes('Audio:')) {
        console.log(`[RTMPIngest] FFmpeg info:`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          message: message.trim(),
        })
      } else if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
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
      })
      
      this.ffmpegProcess = null
      this.stopAudioMetrics()
      
      // Если FFmpeg упал с кодом 1 — это часто "поток ещё не готов" или временная ошибка
      if (code === 1) {
        console.warn(`[RTMPIngest] FFmpeg exited with code 1 (stream may not be ready yet)`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          lastStderrLines: this.ffmpegStderrLines,
          restartAttempts: this.ffmpegRestartAttempts,
        })
        
        // Авторетрай, если сессия ещё активна и кол-во попыток не превышено
        if (this.isActiveFlag && this.ffmpegRestartAttempts < this.MAX_FFMPEG_RESTARTS) {
          const attempt = ++this.ffmpegRestartAttempts
          const delayMs = 1000
          
          console.warn(`[RTMPIngest] Scheduling FFmpeg restart (attempt ${attempt}/${this.MAX_FFMPEG_RESTARTS}) in ${delayMs}ms`, {
            sessionId: this.config.sessionId,
            sessionSlug: this.config.sessionSlug,
          })
          
          setTimeout(() => {
            // Защита: перезапуск только если сессия всё ещё активна и процесс не был запущен заново
            if (this.isActiveFlag && !this.ffmpegProcess) {
              this.startFFmpegDecoder().catch((error) => {
                console.error(`[RTMPIngest] Failed to restart FFmpeg decoder`, {
                  sessionId: this.config.sessionId,
                  sessionSlug: this.config.sessionSlug,
                  error: error.message,
                })
              })
            }
          }, delayMs)
        }
        
        return
      }
      
      // Остальные не-фатальные коды (0, 255) — просто логируем
      if (code === 0 || code === 255 || code === null) {
        console.log(`[RTMPIngest] FFmpeg exited gracefully`, {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          exitCode: code,
        })
        return
      }
      
      // Всё остальное — реально ошибка
      console.error(`[RTMPIngest] FFmpeg exited with unexpected error code`, {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
        exitCode: code,
        signal,
        lastStderrLines: this.ffmpegStderrLines,
      })
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
    this.ffmpegRestartAttempts = 0
    this.ffmpegStderrLines = []
    // Сбрасываем телеметрию при остановке FFmpeg
    this.lastAudioChunkSentAt = null
    this.lastTranscriptReceivedAt = null
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
      console.error('[RTMPIngest] ❌ WS_BASE_URL is not set in HTTP broadcast mode', {
        sessionSlug,
        sessionId: this.config.sessionId,
      })
      // fail-soft: просто не шлём, но не падаем
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

    const now = Date.now()
    this.lastTranscriptReceivedAt = now

    // Телеметрия: задержка от последней отправки аудио до получения транскрипта
    // Используем receivedAt от Gladia Bridge для более точного измерения
    if (event.receivedAt) {
      // Время от получения аудио Gladia до обработки в нашем коде
      const processingLatency = now - event.receivedAt
      recordLatency('ingest.processing_latency_ms', processingLatency)
    }
    
    // Метрика: время от последней отправки аудио чанка до получения транскрипта
    // Это показывает общую задержку пайплайна (FFmpeg → Gladia → наш код)
    if (this.lastAudioChunkSentAt) {
      const diff = now - this.lastAudioChunkSentAt
      recordLatency('stt.end_to_transcript_ms', diff)
      
      // Предупреждение при высоких задержках
      if (diff > 2000) {
        console.warn('[METRICS] ⚠️ High STT latency', {
          sessionId: this.config.sessionId,
          sessionSlug: this.config.sessionSlug,
          diffMs: diff,
          isFinal: event.isFinal,
          textPreview: event.text.slice(0, 80),
        })
      }
    } else {
      // Если lastAudioChunkSentAt не установлен, это может означать:
      // 1. Транскрипт пришел до первого чанка (маловероятно)
      // 2. FFmpeg еще не начал отправлять данные
      // Логируем для отладки
      if (Math.random() < 0.1) { // 10% логов
        console.warn('[RTMPIngest] ⚠️ Transcript received but lastAudioChunkSentAt is null', {
          sessionSlug: this.config.sessionSlug,
          utteranceId: event.utteranceId,
          isFinal: event.isFinal,
        })
      }
    }

    // Получаем текущего активного спикера для этой сессии
    // active-speaker-tracker из LiveKit - основной источник
    // event.speakerId от Gladia - fallback (Gladia Live v2 не дает полноценной diarization)
    const activeSpeaker = getActiveSpeaker(this.config.sessionSlug)
    const speakerIdentity = activeSpeaker?.identity || event.speakerId || 'room'
    const speakerName = activeSpeaker?.name || event.speakerName || 'Meeting'

    // Вычисляем задержку обработки в Gladia (если есть receivedAt от Gladia Bridge)
    const gladiaProcessingTime = event.receivedAt 
      ? now - event.receivedAt 
      : null

    // Логируем получение транскрипта от Gladia с детальными метриками
    console.log('[RTMPIngest] 📨 Received transcript from Gladia', {
      sessionId: this.config.sessionId,
      sessionSlug: this.config.sessionSlug,
      textPreview: event.text.slice(0, 80),
      isFinal: event.isFinal,
      utteranceId: event.utteranceId,
      speakerIdentity,
      speakerName,
      gladiaSpeakerId: event.speakerId,
      timestamp: now,
      timestampISO: new Date(now).toISOString(),
      // Метрики задержек
      gladiaProcessingTimeMs: gladiaProcessingTime, // Время обработки в Gladia (если доступно)
      startedAt: event.startedAt?.toISOString(),
      endedAt: event.endedAt?.toISOString(),
    })

    // Формируем payload для broadcast
    const deliveryTs = Date.now()
    const broadcastBody = {
      sessionSlug: this.config.sessionSlug,
      utteranceId: event.utteranceId,
      text: event.text,
      isFinal: event.isFinal,
      speaker: speakerIdentity,
      speakerId: speakerIdentity,
      ts: deliveryTs,
    }

    // Метрика gladia.stt_latency_ms уже записывается в gladia-bridge.ts
    // Здесь мы только используем её для логирования

    // Основной путь: прямой WS broadcast (direct mode) или HTTP (fallback)
    if (REALTIME_BROADCAST_MODE === 'direct') {
      // Основной боевой путь: прямой WS broadcast без HTTP-хопа
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

      const broadcastStart = Date.now()
      broadcastToSessionClients(this.config.sessionSlug, payload)
      const broadcastEnd = Date.now()
      
      // Телеметрия: время broadcast loop и счетчик отправленных транскриптов
      recordLatency('ws.broadcast_loop_ms', broadcastEnd - broadcastStart)
      recordCounter('ws.transcripts_sent')
      
      // Метрики: общая задержка обработки в ingest
      const ingestLatency = broadcastEnd - broadcastBody.ts
      recordLatency('ingest.broadcast_latency_ms', ingestLatency)
    } else {
      // Fallback / интеграционный режим через HTTP
      const sendStartAt = Date.now()
      this.sendTranscriptToWebSocketServer(this.config.sessionSlug, broadcastBody)
        .then(() => {
          const sendCompleteAt = Date.now()
          const httpLatency = sendCompleteAt - sendStartAt
          
          // Метрики: HTTP POST latency
          recordLatency('http.post_latency_ms', httpLatency)
          
          // Метрики: общая задержка обработки в ingest
          const ingestLatency = sendCompleteAt - broadcastBody.ts
          recordLatency('ingest.broadcast_latency_ms', ingestLatency)
          
          // Детальные метрики задержек для анализа производительности
          // Логируем для всех финальных транскриптов и 10% interim
          if (event.isFinal || Math.random() < 0.1) {
            console.log('[RTMPIngest] ⏱️ Transcript delivery metrics (HTTP mode)', {
              sessionSlug: this.config.sessionSlug,
              isFinal: event.isFinal,
              utteranceId: event.utteranceId,
              textPreview: event.text.slice(0, 50),
              httpPostLatencyMs: httpLatency,
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
    }

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

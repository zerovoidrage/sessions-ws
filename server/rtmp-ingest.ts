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
      try {
        await this.startFFmpegDecoder()
      } catch (ffmpegError: any) {
        // Если FFmpeg не установлен, не падаем полностью - просто логируем
        // Транскрипция не будет работать, но сервер продолжит работать
        if (ffmpegError?.code === 'ENOENT' || ffmpegError?.message?.includes('ENOENT')) {
          console.error(`[RTMPIngest] ⚠️ FFmpeg not found. Transcription will not work until FFmpeg is installed.`)
          console.error(`[RTMPIngest] Install FFmpeg in Railway: Add to Dockerfile or use nixpacks.toml`)
          // Не бросаем ошибку - позволяем процессу продолжиться
          // Egress все равно запустится, просто декодирование не будет работать
        } else {
          throw ffmpegError
        }
      }

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

    // Проверяем наличие FFmpeg перед запуском
    try {
      const { execSync } = await import('child_process')
      execSync('which ffmpeg', { stdio: 'ignore' })
    } catch (error) {
      const errorMsg = 'FFmpeg not found in PATH. Please install FFmpeg.'
      console.error(`[RTMPIngest] ${errorMsg}`)
      throw new Error(errorMsg)
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
      if (error.message.includes('ENOENT') || (error as any).code === 'ENOENT') {
        const errorMsg = `[RTMPIngest] FFmpeg not found. Please install FFmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)`
        console.error(errorMsg)
        // Не бросаем ошибку, которая убьет сервер - просто логируем
        // Транскрипция не запустится, но сервер продолжит работать
        // Останавливаем процесс, но не падаем
        this.ffmpegProcess = null
        this.isActiveFlag = false
        return
      }
      // Для других ошибок тоже не падаем - просто логируем
      this.ffmpegProcess = null
      this.isActiveFlag = false
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

    // Получаем текущего активного спикера для этой сессии
    const activeSpeaker = getActiveSpeaker(this.config.sessionSlug)
    const speakerIdentity = activeSpeaker?.identity || 'room'
    const speakerName = activeSpeaker?.name || 'Meeting'

    // 1. Отправляем транскрипт всем подключенным клиентам сессии
    broadcastToSessionClients(this.config.sessionId, {
      type: 'transcription',
      speakerId: speakerIdentity,
      speakerName: speakerName,
      text: event.text,
      isFinal: event.isFinal,
      ts: Date.now(),
      utterance_id: event.utteranceId,
    })

    // 2. Сохраняем финальные транскрипты в БД
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
        console.error('[RTMPIngest] Failed to append transcript chunk:', error)
      })
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


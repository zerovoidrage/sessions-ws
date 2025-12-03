/**
 * Глобальный RTMP сервер для приема потоков от Room Composite Egress.
 * 
 * Один RTMP сервер обрабатывает потоки от всех сессий.
 * Каждый поток маршрутизируется к соответствующему обработчику на основе StreamPath.
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'events'

const require = createRequire(import.meta.url)
const NodeMediaServer = require('node-media-server')

export interface RTMPStreamHandler {
  onStreamStart(streamPath: string): void
  onStreamData(streamPath: string, data: Buffer): void
  onStreamEnd(streamPath: string): void
}

/**
 * Глобальный RTMP сервер.
 * Один экземпляр для всех сессий.
 */
class RTMPServer extends EventEmitter {
  private nms: any = null
  private streamHandlers = new Map<string, RTMPStreamHandler>() // streamPath -> handler
  private isRunning = false
  private rtmpPort: number
  private autoIngestCallback: ((streamPath: string) => Promise<void>) | null = null

  constructor(rtmpPort: number = 1936) {
    super()
    this.rtmpPort = rtmpPort
  }

  /**
   * Включает автоматическое создание RTMP Ingest при получении потока.
   * Используется в режиме разделенных сервисов (SERVER_MODE=rtmp).
   */
  enableAutoIngest(callback: (streamPath: string) => Promise<void>): void {
    this.autoIngestCallback = callback
    console.log('[RTMPServer] Auto-ingest enabled')
  }

  /**
   * Запускает RTMP сервер.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[RTMPServer] Already running')
      return
    }

    this.nms = new NodeMediaServer({
      rtmp: {
        port: this.rtmpPort,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      // Отключаем HTTP сервер - он конфликтует с основным HTTP сервером на порту 8000
      // Нам нужен только RTMP сервер
      // http: {
      //   port: 8000,
      //   allow_origin: '*',
      // },
    })

    // Обработка подключения RTMP потока
    this.nms.on('preConnect', (id: string, args: any) => {
      console.log(`[RTMPServer] RTMP client connecting: ${id}`, args)
    })

    this.nms.on('postConnect', (id: string, args: any) => {
      console.log(`[RTMPServer] RTMP client connected: ${id}`)
    })

    this.nms.on('prePublish', async (id: any, streamPath: string | undefined, args: any) => {
      // Node-Media-Server передает id как объект RtmpSession, а streamPath может быть внутри него
      const actualStreamPath = streamPath || id?.streamPath || args?.path || args?.streamPath
      const sessionId = typeof id === 'object' ? id?.id : id
      console.log(`[RTMPServer] RTMP stream publishing: ${actualStreamPath}`, { 
        sessionId,
      })
      
      if (!actualStreamPath) {
        console.warn(`[RTMPServer] Could not determine streamPath from prePublish event`, { 
          id: typeof id === 'object' ? id?.id : id, 
          streamPath, 
          args,
          idKeys: typeof id === 'object' ? Object.keys(id || {}) : [],
        })
        return
      }
      
      const handler = this.streamHandlers.get(actualStreamPath)
      if (handler) {
        handler.onStreamStart(actualStreamPath)
      } else if (this.autoIngestCallback) {
        // Если обработчик не зарегистрирован, но включен auto-ingest, создаем его автоматически
        console.log(`[RTMPServer] No handler registered for ${actualStreamPath}, trying auto-ingest...`)
        try {
          await this.autoIngestCallback(actualStreamPath)
        } catch (error) {
          console.error(`[RTMPServer] Failed to create auto-ingest for ${actualStreamPath}:`, error)
        }
      }
    })

    this.nms.on('postPublish', (id: any, streamPath: string | undefined, args: any) => {
      const actualStreamPath = streamPath || id?.streamPath || args?.path || args?.streamPath
      console.log(`[RTMPServer] RTMP stream published: ${actualStreamPath}`)
    })

    this.nms.on('donePublish', (id: any, streamPath: string | undefined, args: any) => {
      // Node-Media-Server передает id как объект RtmpSession, а streamPath может быть внутри него
      const actualStreamPath = streamPath || id?.streamPath || args?.path || args?.streamPath
      console.log(`[RTMPServer] RTMP stream ended: ${actualStreamPath}`)
      
      if (!actualStreamPath) {
        console.warn(`[RTMPServer] Could not determine streamPath from donePublish event`, { 
          id: typeof id === 'object' ? id?.id : id, 
          streamPath, 
          args,
          idKeys: typeof id === 'object' ? Object.keys(id || {}) : [],
        })
        return
      }
      
      const handler = this.streamHandlers.get(actualStreamPath)
      if (handler) {
        handler.onStreamEnd(actualStreamPath)
      }
    })

    return new Promise((resolve, reject) => {
      // Подписываемся на события ДО запуска
      this.nms.on('serverStarted', () => {
        console.log(`[RTMPServer] ✅ RTMP server started on port ${this.rtmpPort}`)
        this.isRunning = true
        resolve()
      })
      this.nms.on('error', (error: any) => {
        // Если ошибка EADDRINUSE, это означает, что порт уже занят (возможно, HTTP сервер слушает на этом порту)
        if (error?.code === 'EADDRINUSE') {
          console.error(`[RTMPServer] ❌ Port ${this.rtmpPort} is already in use. RTMP server cannot start.`)
          console.error(`[RTMPServer] This usually means Railway set PORT=${this.rtmpPort} for HTTP server.`)
          console.error(`[RTMPServer] Solution: In Railway Settings → Networking, set HTTP/WebSocket port to DEFAULT, add separate TCP proxy on port ${this.rtmpPort} for RTMP.`)
        } else {
          console.error(`[RTMPServer] RTMP server error:`, error)
        }
        reject(error)
      })
      
      // Запускаем сервер
      this.nms.run()
      
      // Fallback: если событие serverStarted не сработает, считаем что сервер запущен через небольшую задержку
      setTimeout(() => {
        if (!this.isRunning && this.nms) {
          console.log(`[RTMPServer] ✅ RTMP server started on port ${this.rtmpPort} (fallback detection)`)
          this.isRunning = true
          resolve()
        }
      }, 1000)
    })
  }

  /**
   * Регистрирует обработчик для потока.
   */
  registerStreamHandler(streamPath: string, handler: RTMPStreamHandler): void {
    this.streamHandlers.set(streamPath, handler)
    console.log(`[RTMPServer] Registered handler for stream: ${streamPath}`)
  }

  /**
   * Удаляет обработчик потока.
   */
  unregisterStreamHandler(streamPath: string): void {
    this.streamHandlers.delete(streamPath)
    console.log(`[RTMPServer] Unregistered handler for stream: ${streamPath}`)
  }

  /**
   * Останавливает RTMP сервер.
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    if (this.nms) {
      this.nms.stop()
      this.nms = null
    }

    this.streamHandlers.clear()
    this.isRunning = false
    console.log(`[RTMPServer] ✅ RTMP server stopped`)
  }

  isActive(): boolean {
    return this.isRunning
  }

  getPort(): number {
    return this.rtmpPort
  }
}

// Глобальный экземпляр RTMP сервера
let globalRTMPServer: RTMPServer | null = null

/**
 * Получает или создает глобальный RTMP сервер.
 */
export function getGlobalRTMPServer(): RTMPServer {
  if (!globalRTMPServer) {
    // Внутренний порт - 1936 по умолчанию (где слушает RTMP сервер внутри контейнера)
    // Внешний порт (через TCP прокси) указывается отдельно в RTMP_EXTERNAL_PORT
    const rtmpInternalPort = parseInt(process.env.RTMP_INTERNAL_PORT || process.env.RTMP_PORT || '1937', 10)
    globalRTMPServer = new RTMPServer(rtmpInternalPort)
  }
  return globalRTMPServer
}

/**
 * Запускает глобальный RTMP сервер (если еще не запущен).
 */
export async function startGlobalRTMPServer(): Promise<void> {
  const server = getGlobalRTMPServer()
  if (!server.isActive()) {
    await server.start()
  }
}


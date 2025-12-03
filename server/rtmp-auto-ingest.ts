/**
 * Автоматическое создание RTMP Ingest при получении потока на RTMP сервере.
 * 
 * В режиме разделенных сервисов (SERVER_MODE=rtmp) RTMP сервер должен автоматически
 * создавать RTMP Ingest при получении потока от LiveKit Egress.
 */

import { getGlobalRTMPServer, type RTMPStreamHandler } from './rtmp-server.js'
import { createRTMPIngest, type RTMPIngest } from './rtmp-ingest.js'

// Реестр активных RTMP Ingest по sessionSlug
const activeIngests = new Map<string, RTMPIngest>()

/**
 * Извлекает sessionSlug из streamPath.
 * Ожидаемый формат: /live/{sessionSlug}
 */
function extractSessionSlug(streamPath: string | undefined): string | null {
  if (!streamPath) {
    return null
  }

  // Формат: /live/{sessionSlug}
  const match = streamPath.match(/^\/live\/([^\/]+)$/)
  if (match && match[1]) {
    return match[1]
  }

  return null
}

/**
 * Создает RTMP Ingest автоматически при получении потока.
 */
async function createAutoIngest(sessionSlug: string): Promise<RTMPIngest> {
  console.log(`[RTMPAutoIngest] Creating RTMP Ingest for session slug: ${sessionSlug}`)

  // Для sessionId используем sessionSlug (в режиме разделенных сервисов это допустимо)
  // Или можно генерировать временный ID
  const sessionId = `auto-${sessionSlug}-${Date.now()}`

  const ingest = await createRTMPIngest({
    sessionId,
    sessionSlug,
    rtmpPort: parseInt(process.env.RTMP_PORT || '1937', 10),
  })

  activeIngests.set(sessionSlug, ingest)
  console.log(`[RTMPAutoIngest] ✅ RTMP Ingest created for session slug: ${sessionSlug}`)

  return ingest
}

/**
 * Инициализирует автоматическое создание RTMP Ingest на RTMP сервере.
 * Вызывается при старте RTMP сервера в режиме SERVER_MODE=rtmp.
 */
export async function initializeAutoIngest(): Promise<void> {
  const rtmpServer = getGlobalRTMPServer()

  // Callback для автоматического создания RTMP Ingest при получении потока
  const autoIngestCallback = async (streamPath: string): Promise<void> => {
    console.log(`[RTMPAutoIngest] Stream started: ${streamPath}`)

    const sessionSlug = extractSessionSlug(streamPath)
    if (!sessionSlug) {
      console.warn(`[RTMPAutoIngest] ⚠️ Could not extract sessionSlug from streamPath: ${streamPath}`)
      return
    }

    // Проверяем, не создан ли уже ingest для этого sessionSlug
    if (activeIngests.has(sessionSlug)) {
      console.log(`[RTMPAutoIngest] RTMP Ingest already exists for session slug: ${sessionSlug}`)
      return
    }

    try {
      const ingest = await createAutoIngest(sessionSlug)
      
      // Поскольку поток уже активен (prePublish уже произошел),
      // запускаем FFmpeg сразу после создания RTMPIngest
      try {
        await ingest.startFFmpegNow()
        console.log(`[RTMPAutoIngest] ✅ FFmpeg started for session slug: ${sessionSlug}`)
      } catch (error) {
        console.error(`[RTMPAutoIngest] Failed to start FFmpeg for session slug ${sessionSlug}:`, error)
        // Не удаляем ingest - он все равно может быть полезен
      }
      
      // Регистрируем обработчик для этого потока для корректной обработки onStreamEnd
      const handler: RTMPStreamHandler = {
        onStreamStart: () => {
          // Поток уже начался, FFmpeg уже запущен выше
          console.log(`[RTMPAutoIngest] Stream already started, FFmpeg should be running: ${streamPath}`)
        },
        onStreamData: () => {},
        onStreamEnd: async (path: string) => {
          console.log(`[RTMPAutoIngest] Stream ended: ${path}`)
          const slug = extractSessionSlug(path)
          if (!slug) return
          const ingest = activeIngests.get(slug)
          if (ingest) {
            try {
              await ingest.stop()
              activeIngests.delete(slug)
              console.log(`[RTMPAutoIngest] ✅ RTMP Ingest stopped and removed for session slug: ${slug}`)
            } catch (error) {
              console.error(`[RTMPAutoIngest] Failed to stop RTMP Ingest for session slug ${slug}:`, error)
            }
          }
        },
      }
      rtmpServer.registerStreamHandler(streamPath, handler)
    } catch (error) {
      console.error(`[RTMPAutoIngest] Failed to create RTMP Ingest for session slug ${sessionSlug}:`, error)
    }
  }

  // Включаем автоматическое создание RTMP Ingest
  rtmpServer.enableAutoIngest(autoIngestCallback)
  console.log(`[RTMPAutoIngest] ✅ Auto-ingest initialized for RTMP server`)
}

/**
 * Останавливает все активные RTMP Ingest.
 */
export async function stopAllIngests(): Promise<void> {
  console.log(`[RTMPAutoIngest] Stopping all active ingests (count: ${activeIngests.size})`)
  const stopPromises = Array.from(activeIngests.values()).map((ingest) => ingest.stop())
  await Promise.all(stopPromises)
  activeIngests.clear()
  console.log(`[RTMPAutoIngest] ✅ All ingests stopped`)
}


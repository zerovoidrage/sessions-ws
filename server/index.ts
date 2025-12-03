import http from 'http'
import { WebSocketServer } from 'ws'
import url from 'url'
import { getMetrics } from './metrics.js'
import { getQueueMetrics, flushAllPending, stopFlushTimer } from './transcript-batch-queue.js'
import { startGlobalRTMPServer } from './rtmp-server.js'
import { handleTranscripts } from './transcripts.js'
import { handleBroadcast } from './broadcast.js'
import { initWebSocketConnection, validateTokenAndSession } from './ws-handlers.js'
import { isTestModeEnabled } from './env.js'
import { sendTranscriptionErrorToSessionClients } from './client-connection.js'

// Режим работы сервера: 'ws' (WebSocket только), 'rtmp' (RTMP только), или undefined (оба - для обратной совместимости)
const SERVER_MODE = process.env.SERVER_MODE // 'ws' | 'rtmp' | undefined
const RTMP_PORT = parseInt(process.env.RTMP_PORT || '1937', 10)
const envPort = Number(process.env.PORT)
const port = Number.isFinite(envPort) ? Number(envPort) : 8080

// Логируем конфигурацию портов и режим работы для отладки
const serverMode = SERVER_MODE || 'both'
console.log(`[WS-SERVER] Server mode: ${serverMode}`)
console.log(`[WS-SERVER] Port configuration:`, {
  RTMP_PORT,
  envPORT: envPort || '(not set)',
  finalPORT: port,
})

// Создаём HTTP server с ОЧЕНЬ явной маршрутизацией
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true)
  const pathname = parsedUrl.pathname || '/'

  // Логируем все HTTP запросы
  console.log(`[WS-SERVER] 🔵 HTTP REQUEST: ${req.method} ${req.url}`, {
    host: req.headers.host,
    upgrade: req.headers.upgrade,
    'user-agent': req.headers['user-agent'],
    'content-type': req.headers['content-type'],
  })

  // CORS headers для возможности доступа из браузера
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  res.setHeader('Content-Type', 'application/json')

  // Важно: /api/realtime/transcribe как HTTP endpoint сразу отвергаем
  // Это только WebSocket endpoint
  if (pathname === '/api/realtime/transcribe') {
    res.statusCode = 426
    res.end(JSON.stringify({ error: 'WebSocket endpoint. Use WebSocket upgrade.' }))
    return
  }

  // Health check endpoint
  if (pathname === '/health' && req.method === 'GET') {
    const queueMetrics = getQueueMetrics()
    res.statusCode = 200
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queueLength: queueMetrics.queueLength,
    }))
    return
  }

  // Metrics endpoint
  if (pathname === '/metrics' && req.method === 'GET') {
    try {
      const metrics = getMetrics()
      const queueMetrics = getQueueMetrics()
      res.statusCode = 200
      res.end(JSON.stringify({
        ...metrics,
        queue: queueMetrics,
      }, null, 2))
    } catch (error) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to get metrics' }))
    }
    return
  }

  // API endpoint для приема транскриптов от RTMP сервера (межсервисная связь)
  // Legacy endpoint - использует /api/realtime/transcribe/broadcast
  if (pathname === '/api/transcripts' && req.method === 'POST') {
    // Этот endpoint доступен только в режиме WebSocket сервера
    if (SERVER_MODE === 'rtmp') {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'This endpoint is not available in RTMP-only mode' }))
      return
    }
    return handleTranscripts(req, res)
  }

  // Новый endpoint для broadcast транскриптов (рекомендуемый)
  if (pathname === '/api/realtime/transcribe/broadcast' && req.method === 'POST') {
    // Этот endpoint доступен только в режиме WebSocket сервера
    if (SERVER_MODE === 'rtmp') {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'This endpoint is not available in RTMP-only mode' }))
      return
    }
    return handleBroadcast(req, res)
  }

  // API endpoint для запуска серверной транскрипции
  if (pathname?.startsWith('/api/transcription/start') && req.method === 'POST') {
    console.log(`[WS-SERVER] Received transcription start request: ${req.url}`)
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', async () => {
      let sessionId: string | undefined
      let sessionSlug: string | undefined

      try {
        console.log(`[WS-SERVER] Parsing request body: ${body}`)
        const parsed = JSON.parse(body || '{}')
        sessionId = parsed.sessionId
        sessionSlug = parsed.sessionSlug

        // Валидация обязательных полей
        if (!sessionId || !sessionSlug) {
          const errorMsg = 'Missing sessionId or sessionSlug'
          console.error(`[WS-SERVER] ${errorMsg}`, { sessionId, sessionSlug })
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: errorMsg }))
          return
        }

        // Проверка тестового режима (dev-only)
        const testMode = isTestModeEnabled()
        if (testMode) {
          console.log('[WS-SERVER] DEV TEST MODE: skipping real LiveKit transcription start for session', {
            sessionId,
            sessionSlug,
          })

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, mode: 'test' }))
          return
        }

        // Реальный режим: запускаем транскрипцию через LiveKit
        console.log(`[WS-SERVER] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)

        // Отправляем ответ сразу, чтобы избежать таймаута Railway (30 секунд)
        // Запуск транскрипции делаем асинхронно в фоне
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, mode: 'live' }))

        // Запускаем транскрипцию асинхронно (не блокируем ответ)
        const { startServerTranscription } = await import('./livekit-transcriber.js')
        startServerTranscription({ sessionId, sessionSlug })
          .then(() => {
            console.log(`[WS-SERVER] ✅ Transcription started successfully for session ${sessionId}`)
          })
          .catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error)
            const isUnauthorized = errorMessage.includes('Unauthorized') || 
                                  errorMessage.includes('invalid token') ||
                                  errorMessage.includes('go-jose/go-jose')

            // Логируем ошибку с контекстом
            if (isUnauthorized) {
              console.error(`[WS-SERVER] ❌ LiveKit Unauthorized for transcription: invalid token (check LIVEKIT_API_KEY / LIVEKIT_API_SECRET)`, {
                sessionId,
                sessionSlug,
                errorMessage,
              })
            } else {
              console.error(`[WS-SERVER] ❌ Failed to start transcription for session ${sessionId}:`, {
                sessionId,
                sessionSlug,
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
              })
            }

            // Отправляем ошибку клиентам через WebSocket
            const reason = isUnauthorized ? 'livekit_unauthorized' : 'internal_error'
            sendTranscriptionErrorToSessionClients(
              sessionSlug,
              reason,
              isUnauthorized
                ? 'Failed to start transcription: LiveKit authentication failed. Please check API credentials.'
                : undefined
            )
          })
      } catch (parseError: any) {
        console.error('[WS-SERVER] ❌ Error parsing request or starting transcription:', parseError)
        
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            ok: false,
            mode: 'live',
            error: 'transcription_start_failed',
            reason: 'internal_error',
            message: parseError.message || 'Failed to start transcription',
          }))
        }

        // Отправляем ошибку клиентам, если есть sessionSlug
        if (sessionSlug) {
          sendTranscriptionErrorToSessionClients(
            sessionSlug,
            'internal_error',
            'Failed to start transcription. Please contact support.'
          )
        }
      }
    })
    return
  }

  // API endpoint для остановки серверной транскрипции
  if (pathname?.startsWith('/api/transcription/stop') && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing sessionId' }))
          return
        }

        const { stopServerTranscription } = await import('./livekit-transcriber.js')
        await stopServerTranscription(sessionId)

        res.statusCode = 200
        res.end(JSON.stringify({ success: true, sessionId }))
      } catch (error: any) {
        console.error('[WS-SERVER] Error stopping transcription:', error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error.message || 'Failed to stop transcription' }))
        }
      }
    })
    return
  }

  // API endpoint для active speaker events (HTTP вместо WebSocket для лучшей совместимости с Railway)
  if (pathname?.startsWith('/api/active-speaker') && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const { sessionSlug, identity, name, timestamp, token } = data

        if (!sessionSlug || !identity || !token) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing required fields: sessionSlug, identity, token' }))
          return
        }

        // Валидируем токен (используем тот же метод, что и для WebSocket)
        const { verifyTranscriptionToken } = await import('./client-connection.js')
        const tokenData = await Promise.resolve(verifyTranscriptionToken(token))
        if (!tokenData) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Invalid or expired transcription token' }))
          return
        }

        // Обновляем активного спикера
        const { updateActiveSpeaker } = await import('./active-speaker-tracker.js')
        updateActiveSpeaker({
          sessionSlug,
          participantIdentity: identity,
          participantName: name,
          timestamp: timestamp || Date.now(),
        })

        res.statusCode = 200
        res.end(JSON.stringify({ success: true }))
      } catch (error: any) {
        console.error('[WS-SERVER] Error processing active speaker event:', error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error.message || 'Failed to process active speaker event' }))
        }
      }
    })
    return
  }

  // Root endpoint - информация о сервере
  if (pathname === '/' && req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({
      service: 'Sessions WebSocket Transcription Server',
      status: 'running',
      version: '1.0.0',
      mode: SERVER_MODE || 'both',
      endpoints: {
        health: '/health',
        metrics: '/metrics',
        websocket: '/api/realtime/transcribe',
        startTranscription: 'POST /api/transcription/start',
        stopTranscription: 'POST /api/transcription/stop',
      },
      timestamp: new Date().toISOString(),
    }))
    return
  }

  // Тестовый endpoint для проверки доступности сервера
  if (pathname === '/test' && req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({
      status: 'ok',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      port: port,
      env: {
        PORT: process.env.PORT,
        NODE_ENV: process.env.NODE_ENV,
        SERVER_MODE: SERVER_MODE || 'both',
      },
    }))
    return
  }

  // Для всех остальных запросов возвращаем 404
  console.warn(`[WS-SERVER] 404: ${req.method} ${req.url} not found`)
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'Not found', path: req.url, method: req.method }))
})

// WebSocketServer создаём ТОЛЬКО в режиме, отличном от 'rtmp'
let wss: WebSocketServer | null = null
let egressWss: WebSocketServer | null = null

if (SERVER_MODE !== 'rtmp') {
  // Ключевое изменение: используем noServer: true для полного контроля над upgrade
  wss = new WebSocketServer({
    noServer: true, // <-- ключевой момент
    perMessageDeflate: false, // для устранения Invalid frame header через прокси
  })

  // Все события connection/close/ping/pong обрабатываются в ws-handlers
  wss.on('connection', (ws, request) => {
    // request будет передан при вызове handleUpgrade, но нам нужен clientInfo
    // Поэтому мы передадим его через кастомное свойство
    const clientInfo = (request as any).clientInfo || {}
    initWebSocketConnection(ws, request, clientInfo)
  })

  // WebSocket endpoint для получения аудио потока от LiveKit Track Egress
  // Формат URL: /egress/audio/{sessionId}/{trackId}
  egressWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })

  egressWss.on('connection', (ws, req: http.IncomingMessage) => {
    // Парсим sessionId и trackId из URL
    const parsedUrl = url.parse(req.url || '', true)
    const pathParts = (parsedUrl.pathname || '').split('/').filter(Boolean)
    // pathParts: ['egress', 'audio', sessionId, trackId]

    if (pathParts.length < 4) {
      ws.close(4001, 'Invalid URL format. Expected: /egress/audio/{sessionId}/{trackId}')
      return
    }

    const sessionId = pathParts[2]
    const trackId = pathParts[3]

    if (!sessionId || !trackId) {
      ws.close(4001, 'Missing sessionId or trackId')
      return
    }

    console.log(`[WS-SERVER] Egress audio connection for session ${sessionId}, track ${trackId}`)

    // Регистрируем WebSocket соединение в транскрайбере
    // Динамический импорт, чтобы избежать циклических зависимостей
    import('./livekit-egress-transcriber.js')
      .then(({ registerEgressWebSocketConnection }) => {
        registerEgressWebSocketConnection(sessionId, trackId, ws)
      })
      .catch((error) => {
        console.error(`[WS-SERVER] Failed to register Egress WebSocket:`, error)
        ws.close(5000, 'Failed to register connection')
      })
  })

  // Явно и очень аккуратно обрабатываем upgrade
  // ВАЖНО: этот обработчик должен быть ОДИН на весь сервер
  server.on('upgrade', (req, socket, head) => {
    const parsedUrl = url.parse(req.url || '', true)
    const pathname = parsedUrl.pathname || ''

    console.log(`[WS-SERVER] 🔄 Upgrade request received: ${pathname}`, {
      method: req.method,
      url: req.url,
      headers: {
        upgrade: req.headers.upgrade,
        connection: req.headers.connection,
        'sec-websocket-key': req.headers['sec-websocket-key']?.substring(0, 20) + '...',
        'sec-websocket-version': req.headers['sec-websocket-version'],
        host: req.headers.host,
        origin: req.headers.origin,
      },
      remoteAddress: socket.remoteAddress,
    })

    // В режиме RTMP-only отклоняем WebSocket запросы
    if (SERVER_MODE === 'rtmp') {
      console.warn(`[WS-SERVER] WebSocket upgrade rejected: RTMP-only mode`)
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    // Обрабатываем /api/realtime/transcribe endpoint
    if (pathname === '/api/realtime/transcribe') {
      if (!wss) {
        console.error('[WS-SERVER] WebSocketServer not initialized')
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
        socket.destroy()
        return
      }

      // Извлекаем токен и sessionSlug из query параметров
      const token = parsedUrl.query?.token as string | undefined
      const sessionSlug = parsedUrl.query?.sessionSlug as string | undefined

      // Валидация токена/сессии ДО handleUpgrade (минимум surface area)
      const authResult = validateTokenAndSession(token, sessionSlug)
      if (!authResult.ok) {
        console.warn(`[WS-SERVER] WebSocket upgrade rejected: authentication failed`)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      // Передаём данные в callback через "clientInfo" (сохраняем в request)
      const clientInfo = {
        sessionSlug: authResult.sessionSlug,
        userId: authResult.userId,
        identity: authResult.identity,
        sessionId: authResult.sessionId,
      }

      // Передаем clientInfo через request объект
      ;(req as any).clientInfo = clientInfo

      console.log(`[WS-SERVER] Forwarding upgrade to WebSocketServer for ${pathname}`, { clientInfo })

      // Передаем управление WebSocketServer
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Это callback вызывается после успешного upgrade
        // WebSocketServer сам вызовет событие 'connection', которое мы обработали выше
        console.log(`[WS-SERVER] ✅ WebSocket upgrade completed for ${pathname}`)
        wss!.emit('connection', ws, req)
      })
      return
    }

    // Обрабатываем /egress/audio endpoint
    if (pathname.startsWith('/egress/audio')) {
      if (!egressWss) {
        console.error('[WS-SERVER] Egress WebSocketServer not initialized')
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
        socket.destroy()
        return
      }

      console.log(`[WS-SERVER] Forwarding upgrade to Egress WebSocketServer for ${pathname}`)

      egressWss.handleUpgrade(req, socket, head, (ws) => {
        console.log(`[WS-SERVER] ✅ Egress WebSocket upgrade completed for ${pathname}`)
        egressWss!.emit('connection', ws, req)
      })
      return
    }

    // Если путь не подошел ни одному WebSocketServer, закрываем соединение
    console.warn(`[WS-SERVER] ⚠️ Upgrade request for unknown path: ${pathname}`)
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  })
}

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[WS-SERVER] ❌ Port ${port} is already in use!`)
    console.error(`[WS-SERVER] To fix:`)
    console.error(`[WS-SERVER]   1. Kill the process using port ${port}: lsof -ti:${port} | xargs kill`)
    console.error(`[WS-SERVER]   2. Or start dev server on another port: PORT=3002 npm run dev`)
    process.exit(1)
  } else {
    console.error(`[WS-SERVER] ❌ Server error:`, error)
    process.exit(1)
  }
})

// В режиме RTMP-only запускаем только RTMP сервер, без HTTP
if (SERVER_MODE === 'rtmp') {
  console.log(`[WS-SERVER] ✅ Server running in RTMP-only mode`)

  try {
    await startGlobalRTMPServer()
    console.log(`[WS-SERVER] ✅ RTMP server started on port ${RTMP_PORT}`)
  } catch (error: any) {
    console.error(`[WS-SERVER] ❌ Failed to start RTMP server:`, error)
    if (error?.code === 'EADDRINUSE') {
      console.error(`[WS-SERVER] ❌ RTMP port ${RTMP_PORT} is already in use.`)
    }
    console.error(`[WS-SERVER] ❌ RTMP server failed to start in RTMP-only mode. Exiting.`)
    process.exit(1)
  }

  // Graceful shutdown для RTMP режима
  process.on('SIGTERM', async () => {
    console.log('[WS-SERVER] SIGTERM received, shutting down gracefully...')
    process.exit(0)
  })
} else {
  // Режим WebSocket или оба сервера - запускаем HTTP сервер
  server.listen(port, '0.0.0.0', async () => {
    const serverMode = SERVER_MODE || 'both'
    console.log(`[WS-SERVER] ✅ Server running in mode: ${serverMode}`)

    console.log(`[WS-SERVER] ✅ HTTP/WebSocket server running on port ${port}`)
    console.log(`[WS-SERVER] Metrics endpoint: http://0.0.0.0:${port}/metrics`)
    console.log(`[WS-SERVER] Health check: http://0.0.0.0:${port}/health`)
    console.log(`[WS-SERVER] WebSocket endpoint: ws://0.0.0.0:${port}/api/realtime/transcribe`)

    // Запускаем глобальный RTMP сервер в зависимости от режима
    if (SERVER_MODE === 'ws') {
      // WebSocket-only режим: RTMP сервер не запускается
      console.log(`[WS-SERVER] RTMP server disabled (SERVER_MODE=ws)`)
    } else {
      // Запускаем RTMP сервер в режиме 'both'
      if (port === RTMP_PORT) {
        console.error(`[WS-SERVER] ⚠️ Skipping RTMP server startup: HTTP/WebSocket server is already using port ${RTMP_PORT}`)
        console.error(`[WS-SERVER] ⚠️ Room Composite Egress transcription will not work.`)
        console.error(`[WS-SERVER] ⚠️ Solution: Set SERVER_MODE=rtmp for RTMP-only service, or use different ports.`)
      } else {
        try {
          await startGlobalRTMPServer()
          console.log(`[WS-SERVER] ✅ RTMP server started for Room Composite Egress on port ${RTMP_PORT}`)
        } catch (error: any) {
          // Если ошибка EADDRINUSE, порт уже занят
          if (error?.code === 'EADDRINUSE') {
            console.error(`[WS-SERVER] ⚠️ RTMP port ${RTMP_PORT} is already in use. Skipping RTMP server startup.`)
            console.error(`[WS-SERVER] ⚠️ Room Composite Egress transcription will not work.`)
          } else {
            console.error(`[WS-SERVER] ❌ Failed to start RTMP server:`, error)
            console.warn(`[WS-SERVER] Room Composite Egress transcription will not work without RTMP server`)
          }
        }
      }
    }
  })
}

// Graceful shutdown: записываем все pending транскрипты перед завершением
const gracefulShutdown = async (signal: string) => {
  console.log(`[WS-SERVER] Received ${signal}, starting graceful shutdown...`)

  // Закрываем WebSocket серверы (если они были созданы)
  if (wss) {
    wss.close(() => {
      console.log('[WS-SERVER] WebSocket server closed')
    })
  }
  if (egressWss) {
    egressWss.close(() => {
      console.log('[WS-SERVER] Egress WebSocket server closed')
    })
  }

  // Закрываем HTTP сервер
  server.close(() => {
    console.log('[WS-SERVER] HTTP server closed')
  })

  // Останавливаем batch-таймер и записываем все pending транскрипты
  try {
    stopFlushTimer()
    await flushAllPending()
    console.log('[WS-SERVER] All pending transcripts flushed')
  } catch (error) {
    console.error('[WS-SERVER] Error flushing pending transcripts:', error)
  }

  // Даем время на завершение операций (максимум 10 секунд)
  setTimeout(() => {
    console.log('[WS-SERVER] Graceful shutdown completed')
    process.exit(0)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

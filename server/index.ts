import http from 'http'
import { WebSocketServer } from 'ws'
import { handleClientConnection } from './client-connection.js'
import { getMetrics } from './metrics.js'
import { getQueueMetrics, flushAllPending, stopFlushTimer } from './transcript-batch-queue.js'
import { startGlobalRTMPServer } from './rtmp-server.js'
import { broadcastToSessionClients } from './client-connection.js'

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

// Создаем HTTP сервер для WebSocket upgrade
const server = http.createServer()

// HTTP endpoint для метрик
server.on('request', (req, res) => {
  // Логируем ВСЕ входящие запросы в самом начале
  console.log(`[WS-SERVER] 🔵 HTTP REQUEST: ${req.method} ${req.url}`, {
    host: req.headers.host,
    upgrade: req.headers.upgrade,
    'user-agent': req.headers['user-agent'],
    'content-type': req.headers['content-type'],
  })

  // Пропускаем WebSocket upgrade запросы - их обрабатывает WebSocketServer
  // WebSocketServer слушает событие 'upgrade', которое срабатывает ДО события 'request'
  // Но на всякий случай проверяем заголовок upgrade
  if (req.headers.upgrade === 'websocket') {
    // Не обрабатываем WebSocket запросы в HTTP обработчике
    // WebSocketServer обработает их через событие 'upgrade'
    console.log(`[WS-SERVER] ⚪ Skipping WebSocket upgrade request`)
    return
  }

  // CORS headers для возможности доступа из браузера (опционально)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  
  res.setHeader('Content-Type', 'application/json')

  if (req.url === '/metrics' && req.method === 'GET') {
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

  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    const queueMetrics = getQueueMetrics()
    res.statusCode = 200
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queueLength: queueMetrics.queueLength,
    }))
    return
  }

  // API endpoint для запуска серверной транскрипции
  if (req.url?.startsWith('/api/transcription/start') && req.method === 'POST') {
    console.log(`[WS-SERVER] Received transcription start request: ${req.url}`)
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        console.log(`[WS-SERVER] Parsing request body: ${body}`)
        const { sessionId, sessionSlug } = JSON.parse(body)
        if (!sessionId || !sessionSlug) {
          console.error(`[WS-SERVER] Missing sessionId or sessionSlug in request`)
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing sessionId or sessionSlug' }))
          return
        }

        console.log(`[WS-SERVER] Starting transcription for session ${sessionId} (room: ${sessionSlug})`)
        
        // Отправляем ответ сразу, чтобы избежать таймаута Railway (30 секунд)
        // Запуск транскрипции делаем асинхронно в фоне
        res.statusCode = 200
        res.end(JSON.stringify({ success: true, sessionId, message: 'Transcription start initiated' }))
        
        // Запускаем транскрипцию асинхронно (не блокируем ответ)
        const { startServerTranscription } = await import('./livekit-transcriber.js')
        startServerTranscription({ sessionId, sessionSlug })
          .then(() => {
            console.log(`[WS-SERVER] ✅ Transcription started successfully for session ${sessionId}`)
          })
          .catch((error) => {
            console.error(`[WS-SERVER] ❌ Failed to start transcription for session ${sessionId}:`, error)
          })
      } catch (error: any) {
        console.error('[WS-SERVER] ❌ Error starting transcription:', error)
        res.statusCode = 500
        res.end(JSON.stringify({ error: error.message || 'Failed to start transcription' }))
      }
    })
    return
  }

  // API endpoint для остановки серверной транскрипции
  if (req.url?.startsWith('/api/transcription/stop') && req.method === 'POST') {
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
        res.statusCode = 500
        res.end(JSON.stringify({ error: error.message || 'Failed to stop transcription' }))
      }
    })
    return
  }

  // API endpoint для приема транскриптов от RTMP сервера (межсервисная связь)
  if (req.url?.startsWith('/api/transcripts') && req.method === 'POST') {
    // Этот endpoint доступен только в режиме WebSocket сервера
    if (SERVER_MODE === 'rtmp') {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'This endpoint is not available in RTMP-only mode' }))
      return
    }

    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        // Проверка авторизации (shared secret между сервисами)
        const authHeader = req.headers.authorization
        const expectedSecret = process.env.RTMP_SERVER_SECRET
        if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
          console.warn(`[WS-SERVER] Unauthorized transcript submission attempt from ${req.socket.remoteAddress}`)
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        const transcript = JSON.parse(body)
        const { sessionSlug, ...payload } = transcript

        if (!sessionSlug) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing sessionSlug' }))
          return
        }

        console.log(`[WS-SERVER] Received transcript from RTMP server for session: ${sessionSlug}`)
        
        // Broadcast транскрипта всем подключенным WebSocket клиентам сессии
        broadcastToSessionClients(sessionSlug, payload)

        res.statusCode = 200
        res.end(JSON.stringify({ status: 'ok' }))
      } catch (error: any) {
        console.error('[WS-SERVER] Error processing transcript from RTMP server:', error)
        res.statusCode = 400
        res.end(JSON.stringify({ error: error.message || 'Invalid request' }))
      }
    })
    return
  }

  // API endpoint для active speaker events (HTTP вместо WebSocket для лучшей совместимости с Railway)
  if (req.url?.startsWith('/api/active-speaker') && req.method === 'POST') {
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
        res.statusCode = 500
        res.end(JSON.stringify({ error: error.message || 'Failed to process active speaker event' }))
      }
    })
    return
  }

  // Root endpoint - информация о сервере
  if (req.url === '/' && req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({
      service: 'Sessions WebSocket Transcription Server',
      status: 'running',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        metrics: '/metrics',
        websocket: '/api/realtime/transcribe',
        startTranscription: 'POST /api/transcription/start',
        stopTranscription: 'POST /api/transcription/stop'
      },
      timestamp: new Date().toISOString()
    }))
    return
  }

  // Тестовый endpoint для проверки доступности сервера
  if (req.url === '/test' && req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({ 
      status: 'ok', 
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      port: port,
      env: {
        PORT: process.env.PORT,
        NODE_ENV: process.env.NODE_ENV,
      }
    }))
    return
  }

  // Для всех остальных запросов возвращаем 404
  console.warn(`[WS-SERVER] 404: ${req.method} ${req.url} not found`)
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'Not found', path: req.url, method: req.method }))
})

// Создаём WebSocketServer только если не в режиме RTMP-only
let wss: WebSocketServer | null = null
let egressWss: WebSocketServer | null = null

if (SERVER_MODE !== 'rtmp') {
  // WebSocketServer автоматически обрабатывает upgrade запросы для указанного path
  wss = new WebSocketServer({
    server,
    path: '/api/realtime/transcribe',
    perMessageDeflate: false, // Railway proxy корёжит deflate-фреймы — выключаем компрессию
  })

  wss.on('connection', (ws, req: http.IncomingMessage) => {
    console.log(`[WS-SERVER] ✅ WebSocket connection established: ${req.url}`)
    handleClientConnection({ ws, req })
  })

  // WebSocket endpoint для получения аудио потока от LiveKit Track Egress
  // Формат URL: /egress/audio/{sessionId}/{trackId}
  egressWss = new WebSocketServer({
    server,
    path: '/egress/audio',
    perMessageDeflate: false,
  })

  egressWss.on('connection', (ws, req: http.IncomingMessage) => {
    // Парсим sessionId и trackId из URL
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathParts = url.pathname.split('/').filter(Boolean)
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
}

// Добавляем явный обработчик upgrade для логирования и отладки
// ВАЖНО: WebSocketServer уже обрабатывает upgrade для своего path,
// но мы добавляем логирование для всех upgrade запросов ПЕРЕД WebSocketServer
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname
  
  console.log(`[WS-SERVER] 🔄 Upgrade request received: ${pathname}`, {
    method: request.method,
    url: request.url,
    headers: {
      upgrade: request.headers.upgrade,
      connection: request.headers.connection,
      'sec-websocket-key': request.headers['sec-websocket-key']?.substring(0, 20) + '...',
      'sec-websocket-version': request.headers['sec-websocket-version'],
      host: request.headers.host,
      origin: request.headers.origin,
    },
    remoteAddress: request.socket.remoteAddress,
  })
  
  // В режиме RTMP-only отклоняем WebSocket запросы
  if (SERVER_MODE === 'rtmp') {
    console.warn(`[WS-SERVER] WebSocket upgrade rejected: RTMP-only mode`)
    socket.destroy()
    return
  }
  
  // WebSocketServer автоматически обработает upgrade для /api/realtime/transcribe
  // и для /egress/audio/* через свои внутренние обработчики
  // НЕ блокируем запросы - пусть WebSocketServer сам решает
})

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
    
    console.log(`[WS-SERVER] ✅ WebSocket server running on port ${port}`)
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
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('[WS-SERVER] SIGTERM received, shutting down gracefully...')
      await flushAllPending()
      stopFlushTimer()
      server.close(() => {
        console.log('[WS-SERVER] HTTP server closed')
        process.exit(0)
      })
    })
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


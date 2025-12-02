import http from 'http'
import { WebSocketServer } from 'ws'
import { handleClientConnection } from './client-connection.js'
import { getMetrics } from './metrics.js'
import { getQueueMetrics, flushAllPending, stopFlushTimer } from './transcript-batch-queue.js'
import { startGlobalRTMPServer } from './rtmp-server.js'

// Render использует переменную PORT, но можем использовать WS_PORT как fallback
const PORT = process.env.PORT || process.env.WS_PORT || 3001

// Создаем HTTP сервер для WebSocket upgrade
const server = http.createServer()

// HTTP endpoint для метрик
server.on('request', (req, res) => {
  // Пропускаем WebSocket upgrade запросы - их обрабатывает WebSocketServer
  // WebSocketServer слушает событие 'upgrade', которое срабатывает ДО события 'request'
  // Но на всякий случай проверяем заголовок upgrade
  if (req.headers.upgrade === 'websocket') {
    // Не обрабатываем WebSocket запросы в HTTP обработчике
    // WebSocketServer обработает их через событие 'upgrade'
    return
  }

  // Логируем все входящие HTTP запросы для отладки
  console.log(`[WS-SERVER] HTTP ${req.method} ${req.url}`, {
    host: req.headers.host,
    upgrade: req.headers.upgrade,
  })

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
        const { startServerTranscription } = await import('./livekit-transcriber.js')
        await startServerTranscription({ sessionId, sessionSlug })
        
        console.log(`[WS-SERVER] ✅ Transcription started successfully for session ${sessionId}`)
        res.statusCode = 200
        res.end(JSON.stringify({ success: true, sessionId }))
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

  // Для всех остальных запросов возвращаем 404
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'Not found' }))
})

const wss = new WebSocketServer({
  server,
  path: '/api/realtime/transcribe',
})

wss.on('connection', (ws, req: http.IncomingMessage) => {
  handleClientConnection({ ws, req })
})

// WebSocket endpoint для получения аудио потока от LiveKit Track Egress
// Формат URL: /egress/audio/{sessionId}/{trackId}
const egressWss = new WebSocketServer({
  server,
  path: '/egress/audio',
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

server.listen(PORT, async () => {
  console.log(`[WS-SERVER] WebSocket server listening on port ${PORT}`)
  console.log(`[WS-SERVER] Metrics endpoint: http://localhost:${PORT}/metrics`)
  console.log(`[WS-SERVER] Health check: http://localhost:${PORT}/health`)
  
  // Запускаем глобальный RTMP сервер для Room Composite Egress
  try {
    await startGlobalRTMPServer()
    console.log(`[WS-SERVER] ✅ RTMP server started for Room Composite Egress`)
  } catch (error) {
    console.error(`[WS-SERVER] Failed to start RTMP server:`, error)
    console.warn(`[WS-SERVER] Room Composite Egress transcription will not work without RTMP server`)
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

// Graceful shutdown: записываем все pending транскрипты перед завершением
const gracefulShutdown = async (signal: string) => {
  console.log(`[WS-SERVER] Received ${signal}, starting graceful shutdown...`)
  
  // Закрываем новые подключения
  wss.close(() => {
    console.log('[WS-SERVER] WebSocket server closed')
  })
  
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


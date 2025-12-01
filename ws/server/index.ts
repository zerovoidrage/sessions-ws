import http from 'http'
import { WebSocketServer } from 'ws'
import { handleClientConnection } from './client-connection.js'
import { getMetrics } from './metrics.js'
import { getQueueMetrics, flushAllPending, stopFlushTimer } from './transcript-batch-queue.js'

// Render использует переменную PORT, но можем использовать WS_PORT как fallback
const PORT = process.env.PORT || process.env.WS_PORT || 3001

// Создаем HTTP сервер для WebSocket upgrade
const server = http.createServer()

// HTTP endpoint для метрик
server.on('request', (req, res) => {
  // CORS headers для возможности доступа из браузера (опционально)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
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
        websocket: '/api/realtime/transcribe'
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

server.listen(PORT, () => {
  console.log(`[WS-SERVER] WebSocket server listening on port ${PORT}`)
  console.log(`[WS-SERVER] Metrics endpoint: http://localhost:${PORT}/metrics`)
  console.log(`[WS-SERVER] Health check: http://localhost:${PORT}/health`)
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


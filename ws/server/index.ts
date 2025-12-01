import http from 'http'
import { WebSocketServer } from 'ws'
import { handleClientConnection } from './client-connection.js'
import { getMetrics } from './metrics.js'

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
      res.statusCode = 200
      res.end(JSON.stringify(metrics, null, 2))
    } catch (error) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to get metrics' }))
    }
    return
  }

  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
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


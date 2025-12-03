import type { IncomingMessage, ServerResponse } from 'http'
import { broadcastToSessionClients } from './client-connection.js'

const RTMP_SERVER_SECRET = process.env.RTMP_SERVER_SECRET

/**
 * Обрабатывает POST запросы на /api/transcripts от RTMP сервера.
 * Принимает транскрипты и broadcast'ит их всем подключенным WebSocket клиентам сессии.
 */
export async function handleTranscripts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Allow', 'POST')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  // Проверка авторизации через shared secret
  const authHeader = req.headers.authorization
  if (!RTMP_SERVER_SECRET) {
    console.error('[TRANSCRIPTS] RTMP_SERVER_SECRET is not set')
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Server configuration error' }))
    return
  }

  if (!authHeader || authHeader !== `Bearer ${RTMP_SERVER_SECRET}`) {
    console.warn(`[TRANSCRIPTS] Unauthorized transcript submission attempt from ${req.socket.remoteAddress}`)
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk.toString()
  })

  req.on('end', () => {
    try {
      const parsed = JSON.parse(body)
      const { sessionSlug, ...payload } = parsed

      if (!sessionSlug) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Missing sessionSlug' }))
        return
      }

      console.log(`[TRANSCRIPTS] Received transcript from RTMP server for session: ${sessionSlug}`)

      // Broadcast транскрипта всем подключенным WebSocket клиентам сессии
      broadcastToSessionClients(sessionSlug, payload)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, status: 'ok' }))
    } catch (err: any) {
      console.error('[TRANSCRIPTS] Failed to parse body', err)
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Invalid JSON', details: err.message }))
    }
  })

  req.on('error', (err) => {
    console.error('[TRANSCRIPTS] Request error', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })
}


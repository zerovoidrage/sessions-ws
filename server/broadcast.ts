// ws-server/server/broadcast.ts
/**
 * HTTP endpoint для broadcast транскриптов всем подключенным WebSocket клиентам.
 * Используется Gladia/RTMP bridge для отправки транскриптов.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { WebSocket } from 'ws'
import { getClientsForSession } from './client-connection.js'
import type { BroadcastTranscriptBody, ServerTranscriptionMessage } from './types.js'

/**
 * Обрабатывает POST запросы на /api/realtime/transcribe/broadcast.
 * Принимает транскрипты от Gladia/RTMP bridge и broadcast'ит их всем подключенным WebSocket клиентам сессии.
 */
export async function handleBroadcast(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Allow', 'POST')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk.toString()
  })

  req.on('end', () => {
    try {
      const parsed = JSON.parse(body) as BroadcastTranscriptBody

      // Валидация обязательных полей
      if (!parsed.sessionSlug) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Missing sessionSlug' }))
        return
      }

      if (!parsed.text || typeof parsed.text !== 'string') {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Missing or invalid text' }))
        return
      }

      if (!parsed.utteranceId) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Missing utteranceId' }))
        return
      }

      const { sessionSlug, userId, utteranceId, text, isFinal, speaker, speakerId, ts } = parsed

      // Находим клиентов для сессии
      const clients = getClientsForSession(sessionSlug)

      if (!clients || clients.size === 0) {
        console.log('[WS-SERVER] No clients to broadcast transcript', {
          sessionSlug,
          textPreview: text.slice(0, 80),
        })

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, sent: 0, message: 'no clients for sessionSlug' }))
        return
      }

      // Собираем ServerTranscriptionMessage
      // Разделяем partial и final типы для лучшей семантики
      const isFinalBool = Boolean(isFinal)
      const payload: ServerTranscriptionMessage = {
        type: isFinalBool ? 'transcript_final' : 'transcript_partial',
        sessionSlug,
        userId,
        utteranceId,
        text,
        isFinal: isFinalBool, // Оставляем для обратной совместимости
        speaker: speaker || speakerId,
        speakerId: speakerId || speaker,
        ts: ts ?? Date.now(),
      }

      // Отправляем всем подключенным клиентам
      let sent = 0
      for (const clientMeta of clients) {
        if (clientMeta.ws.readyState === WebSocket.OPEN) {
          try {
            clientMeta.ws.send(JSON.stringify(payload))
            sent++
          } catch (error) {
            console.error('[WS-SERVER] Failed to send transcript to client', {
              sessionSlug,
              userId: clientMeta.userId,
              error,
            })
          }
        }
      }

      console.log('[WS-SERVER] Broadcast transcript', {
        sessionSlug,
        userId,
        textPreview: text.slice(0, 80),
        clientsInSession: clients.size,
        sent,
      })

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, sent }))
    } catch (err: any) {
      console.error('[WS-SERVER] Failed to parse broadcast body', err)
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Invalid JSON', details: err.message }))
    }
  })

  req.on('error', (err) => {
    console.error('[WS-SERVER] Broadcast request error', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })
}


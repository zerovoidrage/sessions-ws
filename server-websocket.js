require('dotenv').config()

const WebSocket = require('ws')
const http = require('http')
const https = require('https')

const GLADIA_API_KEY = process.env.GLADIA_API_KEY
const GLADIA_API_BASE = 'https://api.gladia.io'

if (!GLADIA_API_KEY) {
  console.error('GLADIA_API_KEY environment variable is required')
  process.exit(1)
}

// Создаем HTTP сервер для WebSocket upgrade
const server = http.createServer()
const wss = new WebSocket.Server({ 
  server,
  path: '/api/realtime/transcribe',
})

wss.on('connection', (clientWs, req) => {
  console.log('[WS-SERVER] Client connected', {
    remoteAddress: req.socket.remoteAddress,
  })

  // Переменные для отслеживания
  let firstChunkAt = null
  let firstTranscriptAt = null
  let gladiaWs = null
  let sessionId = null

  // Инициируем сессию Gladia через POST запрос
  const initSession = () => {
    return new Promise((resolve, reject) => {
      // Согласно документации, нужны: encoding, sample_rate, bit_depth, channels
      // encoding должен быть: wav/pcm, wav/alaw, или wav/ulaw
      // language не должен быть в запросе инициализации
      // Для получения partial transcripts (драфтов) нужно включить messages_config
      const postData = JSON.stringify({
        encoding: 'wav/pcm',
        sample_rate: 16000,
        bit_depth: 16,
        channels: 1,
        messages_config: {
          receive_partial_transcripts: true, // Включаем partial transcripts для драфтов
        },
      })
      
      console.log('[WS-SERVER] Initiating Gladia session', {
        url: 'https://api.gladia.io/v2/live',
        data: postData,
      })

      const options = {
        hostname: 'api.gladia.io',
        path: '/v2/live',
        method: 'POST',
        headers: {
          'x-gladia-key': GLADIA_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          console.log('[WS-SERVER] Session init response:', {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          })
          
          if (res.statusCode !== 201 && res.statusCode !== 200) {
            try {
              const errorResponse = JSON.parse(data)
              console.error('[WS-SERVER] ❌ Failed to init session:', errorResponse)
              reject(new Error(`HTTP ${res.statusCode}: ${errorResponse.message || data}`))
            } catch (e) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            }
            return
          }
          
          try {
            const response = JSON.parse(data)
            console.log('[WS-SERVER] Session init response parsed:', response)
            
            // Согласно документации, ответ содержит поле "url" (WebSocket URL)
            // Также может быть "session_id" или "token"
            let websocketUrl = null
            if (response.url) {
              websocketUrl = response.url
            } else if (response.websocket_url) {
              websocketUrl = response.websocket_url
            } else if (response.token) {
              // Формат: wss://api.gladia.io/v2/live?token={TOKEN}/liveTranscription
              websocketUrl = `wss://api.gladia.io/v2/live?token=${response.token}/liveTranscription`
            }
            
            if (websocketUrl) {
              console.log('[WS-SERVER] ✅ Session initialized', {
                sessionId: response.session_id || response.token || 'unknown',
                websocketUrl: websocketUrl,
                fullResponse: response,
              })
              sessionId = response.session_id || response.token
              resolve(websocketUrl)
            } else {
              console.error('[WS-SERVER] ❌ Failed to init session - no url/websocket_url/token:', response)
              reject(new Error('No url, websocket_url or token in response'))
            }
          } catch (error) {
            console.error('[WS-SERVER] ❌ Error parsing session response:', error, {
              rawData: data,
            })
            reject(error)
          }
        })
      })

      req.on('error', (error) => {
        console.error('[WS-SERVER] ❌ Error initiating session:', error)
        reject(error)
      })

      req.write(postData)
      req.end()
    })
  }

  // Подключаемся к Gladia WebSocket после инициализации сессии
  initSession()
    .then((websocketUrl) => {
      gladiaWs = new WebSocket(websocketUrl, {
        headers: {
          'x-gladia-key': GLADIA_API_KEY,
        },
      })

      gladiaWs.on('open', () => {
        console.log('[WS-SERVER] ✅ Connected to Gladia WebSocket')
      })

      gladiaWs.on('error', (error) => {
        console.error('[WS-SERVER] Gladia WebSocket error:', error)
        if (clientWs.readyState === WebSocket.OPEN) {
          try {
            clientWs.send(JSON.stringify({
              type: 'error',
              message: 'Gladia connection error',
            }))
          } catch (e) {
            console.error('[WS-SERVER] Failed to send error to client:', e)
          }
        }
      })

      gladiaWs.on('close', (code, reason) => {
        console.log('[WS-SERVER] Gladia WebSocket closed', { code, reason: reason.toString() })
        if (clientWs.readyState === WebSocket.OPEN) {
          try {
            clientWs.close()
          } catch (e) {
            console.error('[WS-SERVER] Failed to close client connection:', e)
          }
        }
      })

      // Проксируем аудио от клиента к Gladia
      let audioChunkCount = 0
      clientWs.on('message', (data) => {
        audioChunkCount++
        
        if (!firstChunkAt) {
          firstChunkAt = Date.now()
          console.log('[WS-SERVER] First audio chunk received', {
            size: data.byteLength,
          })
        }

        if (audioChunkCount % 50 === 0) {
          console.log('[WS-SERVER] Audio chunks received', {
            count: audioChunkCount,
            chunkSize: data.byteLength,
            gladiaReady: gladiaWs && gladiaWs.readyState === WebSocket.OPEN,
          })
        }

        if (gladiaWs && gladiaWs.readyState === WebSocket.OPEN) {
          try {
            // Согласно документации Gladia, аудио можно отправлять:
            // 1. Как бинарный фрейм (просто raw bytes)
            // 2. Как JSON с base64: {"type": "audio_chunk", "data": {"chunk": "base64..."}}
            // Используем бинарный фрейм для эффективности
            gladiaWs.send(data)
          } catch (error) {
            console.error('[WS-SERVER] Error sending audio to Gladia:', error)
          }
        } else {
          if (audioChunkCount <= 5) {
            console.warn('[WS-SERVER] Gladia WebSocket not ready, cannot send audio', {
              hasGladiaWs: !!gladiaWs,
              readyState: gladiaWs?.readyState,
              chunkNumber: audioChunkCount,
            })
          }
        }
      })

      // Helper для пересылки текстовых событий на клиента
      const forwardTextToClient = (text, isFinal, utteranceId = null) => {
        if (!text || !clientWs || clientWs.readyState !== WebSocket.OPEN) {
          return
        }

        try {
          clientWs.send(JSON.stringify({
            type: 'transcription',
            text,
            is_final: isFinal,
            utterance_id: utteranceId, // ID сегмента от Gladia для правильной группировки
          }))
        } catch (err) {
          console.error('[WS-SERVER] Error sending to client', err)
        }
      }

      // Обрабатываем сообщения от Gladia
      let messageCount = 0
      gladiaWs.on('message', (data) => {
    messageCount++
    
    try {
      const message = JSON.parse(data.toString())
      
      // Логируем все сообщения для отладки
      if (messageCount <= 20) {
        console.log('[WS-SERVER] 📨 Message from Gladia', {
          number: messageCount,
          event: message.event,
          type: message.type,
          keys: Object.keys(message),
          fullMessage: JSON.stringify(message, null, 2),
        })
      } else if (messageCount % 10 === 0) {
        console.log('[WS-SERVER] 📨 Message from Gladia', {
          number: messageCount,
          event: message.event,
          type: message.type,
        })
      }
      
      // Обрабатываем события от Gladia
      if (message.type === 'start_session') {
        console.log('[WS-SERVER] ✅ Gladia session started', {
          sessionId: message.session_id,
        })
        return
      }
      
      if (message.type === 'error' || message.event === 'error') {
        console.error('[WS-SERVER] ❌ Gladia error:', {
          code: message.code,
          message: message.message,
        })
        if (clientWs.readyState === WebSocket.OPEN) {
          try {
            clientWs.send(JSON.stringify({
              type: 'error',
              message: message.message || 'Gladia transcription error',
            }))
          } catch (e) {
            console.error('[WS-SERVER] Failed to send error to client:', e)
          }
        }
        return
      }
      
      // Отслеживаем время первого транскрипта
      if (!firstTranscriptAt && (message.type === 'transcript' || message.event === 'transcript')) {
        firstTranscriptAt = Date.now()
        const latency = firstChunkAt ? firstTranscriptAt - firstChunkAt : null
        console.log('[WS-SERVER] ⭐ FIRST TRANSCRIPT at', firstTranscriptAt, `latency(ms)=${latency}`)
      }

      // Обрабатываем транскрипты
      // Согласно документации Gladia, формат транскрипта:
      // {
      //   "type": "transcript",
      //   "data": {
      //     "id": "00-00000011",
      //     "is_final": false, // false для partial (драфт), true для финального
      //     "utterance": {
      //       "text": "Hello world.",
      //       ...
      //     }
      //   }
      // }
      let text = null
      let isFinal = false

      if (message.type === 'transcript' && message.data) {
        const transcriptData = message.data
        
        // Основной формат: message.data.utterance.text
        if (transcriptData.utterance && transcriptData.utterance.text) {
          text = transcriptData.utterance.text.trim()
          // is_final определяет, это partial (драфт) или финальный транскрипт
          // false = partial (обновляется в реальном времени)
          // true = финальный (окончательная версия)
          isFinal = transcriptData.is_final === true
          
          // ID сегмента от Gladia - используется для правильной группировки
          // Каждый новый сегмент (utterance) имеет уникальный ID
          const utteranceId = transcriptData.id || null
          
          // Логируем для отладки
          if (messageCount <= 10 || !isFinal) {
            console.log('[WS-SERVER] 📝 Transcript received', {
              utteranceId,
              isFinal,
              isPartial: !isFinal,
              textLength: text.length,
              preview: text.substring(0, 60),
            })
          }

          if (text) {
            console.log('[WS-SERVER] ✅ transcript', {
              utteranceId,
              isFinal,
              textLength: text.length,
              preview: text.substring(0, 60),
            })

            // Отправляем транскрипт клиенту с ID сегмента
            forwardTextToClient(text, isFinal, utteranceId)
          }
        }
      }
    } catch (error) {
      console.error('[WS-SERVER] Error parsing Gladia message:', error, {
        dataPreview: data.toString().substring(0, 200),
      })
    }
  })
    })
    .catch((error) => {
      console.error('[WS-SERVER] ❌ Failed to initialize Gladia session:', error)
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(JSON.stringify({
            type: 'error',
            message: 'Failed to initialize Gladia session',
          }))
          clientWs.close()
        } catch (e) {
          console.error('[WS-SERVER] Failed to send error to client:', e)
        }
      }
    })

  clientWs.on('close', () => {
    console.log('[WS-SERVER] Client disconnected')
    if (gladiaWs && gladiaWs.readyState === WebSocket.OPEN) {
      // Отправляем stop_recording перед закрытием
      try {
        gladiaWs.send(JSON.stringify({ type: 'stop_recording' }))
      } catch (e) {
        console.error('[WS-SERVER] Error sending stop_recording:', e)
      }
      gladiaWs.close()
    }
  })

  clientWs.on('error', (error) => {
    console.error('[WS-SERVER] Client WebSocket error:', error)
  })
})

const PORT = process.env.WS_PORT || 3001
server.listen(PORT, () => {
  console.log(`[WS-SERVER] WebSocket server listening on port ${PORT}`)
})


import https from 'https'
import { WebSocket } from 'ws'
import dotenv from 'dotenv'

dotenv.config()

function getGladiaApiKey(): string {
  const key = process.env.GLADIA_API_KEY
  if (!key) {
    throw new Error('GLADIA_API_KEY is not set')
  }
  return key
}

export interface TranscriptEvent {
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
}

export interface GladiaBridge {
  sendAudio(chunk: ArrayBuffer | Buffer): void
  close(): void
  onTranscript(cb: (event: TranscriptEvent) => void): void
}

export async function createGladiaBridge(): Promise<GladiaBridge> {
  const apiKey = getGladiaApiKey()
  
  // Инициализация сессии через POST /v2/live
  const websocketUrl = await initGladiaSession(apiKey)
  
  // Подключение к WebSocket
  const gladiaWs = new WebSocket(websocketUrl)
  
  let transcriptCallback: ((event: TranscriptEvent) => void) | null = null
  let isReady = false
  
  gladiaWs.on('open', () => {
    console.log('[GladiaBridge] WebSocket connected')
    isReady = true
  })
  
  gladiaWs.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString())
      
      // Обрабатываем транскрипты
      if (message.type === 'transcript' && message.data) {
        const transcriptData = message.data
        
        if (transcriptData.utterance && transcriptData.utterance.text) {
          const text = transcriptData.utterance.text.trim()
          const isFinal = transcriptData.is_final === true
          const utteranceId = transcriptData.id || null
          
          if (text && utteranceId && transcriptCallback) {
            transcriptCallback({
              utteranceId,
              text,
              isFinal,
              startedAt: new Date(),
              endedAt: isFinal ? new Date() : undefined,
            })
          }
        }
      }
    } catch (error) {
      console.error('[GladiaBridge] Error parsing message:', error)
    }
  })
  
  gladiaWs.on('error', (error) => {
    console.error('[GladiaBridge] WebSocket error:', error)
  })
  
  gladiaWs.on('close', () => {
    console.log('[GladiaBridge] WebSocket closed')
    isReady = false
  })
  
  return {
    sendAudio(chunk: ArrayBuffer | Buffer) {
      if (isReady && gladiaWs.readyState === WebSocket.OPEN) {
        gladiaWs.send(chunk)
      }
    },
    close() {
      if (gladiaWs.readyState === WebSocket.OPEN) {
        gladiaWs.close()
      }
    },
    onTranscript(cb: (event: TranscriptEvent) => void) {
      transcriptCallback = cb
    },
  }
}

async function initGladiaSession(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      messages_config: {
        receive_partial_transcripts: true,
      },
    })
    
    const options = {
      hostname: 'api.gladia.io',
      path: '/v2/live',
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
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
        if (res.statusCode !== 201 && res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          return
        }
        
        try {
          const response = JSON.parse(data)
          const websocketUrl = response.url || response.websocket_url
          
          if (websocketUrl) {
            resolve(websocketUrl)
          } else {
            reject(new Error('No websocket_url in response'))
          }
        } catch (error) {
          reject(error)
        }
      })
    })
    
    req.on('error', (error) => {
      reject(error)
    })
    
    req.write(postData)
    req.end()
  })
}


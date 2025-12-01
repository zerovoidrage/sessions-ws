// load-test/ws-load-test.ts
// Минимальный нагрузочный тест для WebSocket сервера транскрипции
// Тестирует: 10-20 фейковых участников, поток транскрипции, мониторинг метрик
// Теперь также подключается к LiveKit комнате и создает участников в БД

import WebSocket from 'ws'
import { performance } from 'perf_hooks'

// LiveKit импорты опциональны (требуют браузерного окружения)
// Можно включить через ENABLE_LIVEKIT=true
const ENABLE_LIVEKIT = process.env.ENABLE_LIVEKIT === 'true'
let Room: any, RoomEvent: any, Track: any, createLocalAudioTrack: any

if (ENABLE_LIVEKIT) {
  try {
    const livekit = require('livekit-client')
    Room = livekit.Room
    RoomEvent = livekit.RoomEvent
    Track = livekit.Track
    createLocalAudioTrack = livekit.createLocalAudioTrack
  } catch (error) {
    console.warn('[Load Test] LiveKit client not available, skipping LiveKit room connections')
    console.warn('  Note: livekit-client requires browser APIs and may not work in Node.js')
    console.warn('  Participants will still be created in DB and connect to transcription WS\n')
  }
}

interface Participant {
  id: string
  identity: string
  name: string
  ws: WebSocket | null
  room: Room | null
  connected: boolean
  roomConnected: boolean
  chunksSent: number
  transcriptsReceived: number
  errors: number
  startTime: number
  token: string | null
  serverUrl: string | null
  participantRecord: any | null // Запись участника в БД
}

interface TestMetrics {
  totalParticipants: number
  connectedParticipants: number
  totalChunksSent: number
  totalTranscriptsReceived: number
  totalErrors: number
  avgLatency: number
  testDuration: number
  queueLength?: number
  cpuUsage?: number
  memoryUsage?: number
}

const WS_HOST = process.env.WS_HOST || 'localhost'
const WS_PORT = process.env.WS_PORT || '3001'
const WS_PROTOCOL = process.env.WS_PROTOCOL || 'ws'
const WS_URL = `${WS_PROTOCOL}://${WS_HOST}:${WS_PORT}/api/realtime/transcribe`

// Получаем полный ответ от API (token, serverUrl, identity, transcriptionToken)
async function getTokenData(identity: string, sessionSlug: string): Promise<{
  token: string
  serverUrl: string
  identity: string
  transcriptionToken: string
} | null> {
  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3000'
    const response = await fetch(`${apiUrl}/api/sessions/${sessionSlug}/token?name=${encodeURIComponent(identity)}&identity=${encodeURIComponent(identity)}`)
    
    if (response.ok) {
      const data = await response.json()
      if (data.token && data.serverUrl && data.identity && data.transcriptionToken) {
        return {
          token: data.token,
          serverUrl: data.serverUrl,
          identity: data.identity,
          transcriptionToken: data.transcriptionToken,
        }
      }
    } else {
      const errorText = await response.text()
      console.error(`[Load Test] Failed to get token: ${response.status} ${errorText}`)
    }
  } catch (error) {
    console.error(`[Load Test] Error fetching token from API:`, error)
  }
  
  return null
}

// Создаем участника в БД через API
async function joinParticipant(sessionSlug: string, identity: string, name: string): Promise<any | null> {
  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3000'
    const response = await fetch(`${apiUrl}/api/sessions/${sessionSlug}/participants/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identity,
        name,
        role: 'GUEST',
        isGuest: true,
      }),
    })
    
    if (response.ok) {
      return await response.json()
    } else {
      const errorText = await response.text()
      console.error(`[Load Test] Failed to join participant: ${response.status} ${errorText}`)
    }
  } catch (error) {
    console.error(`[Load Test] Error joining participant:`, error)
  }
  
  return null
}

// Генерируем фейковый PCM16 аудио чанк (16kHz, моно)
function generateAudioChunk(): Buffer {
  const sampleRate = 16000
  const durationMs = 100 // 100ms чанк
  const samples = (sampleRate * durationMs) / 1000
  const buffer = Buffer.alloc(samples * 2) // 2 bytes per sample (PCM16)

  // Генерируем синусоидальный сигнал (440Hz tone)
  const frequency = 440
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
    const intSample = Math.floor(sample * 32767)
    buffer.writeInt16LE(intSample, i * 2)
  }

  return buffer
}

async function createParticipant(
  id: string,
  identity: string,
  name: string,
  token: string,
  serverUrl: string,
  transcriptionToken: string,
  sessionSlug: string
): Promise<Participant> {
  const participant: Participant = {
    id,
    identity,
    name,
    ws: null,
    room: null,
    connected: false,
    roomConnected: false,
    chunksSent: 0,
    transcriptsReceived: 0,
    errors: 0,
    startTime: performance.now(),
    token,
    serverUrl,
    participantRecord: null,
  }

  // 1. Подключаемся к LiveKit комнате (опционально, требует браузерных API)
  // Участники будут созданы в БД только после успешного подключения к LiveKit
  if (ENABLE_LIVEKIT && Room && RoomEvent) {
    try {
      const room = new Room()
      participant.room = room

      // Обработчики событий комнаты
      room.on(RoomEvent.Connected, async () => {
        participant.roomConnected = true
        console.log(`[Participant ${id}] ✅ Connected to LiveKit room`)
        
        // Создаем участника в БД только после успешного подключения к LiveKit
        try {
          const participantRecord = await joinParticipant(sessionSlug, identity, name)
          if (participantRecord) {
            participant.participantRecord = participantRecord
            console.log(`[Participant ${id}] ✅ Created in DB after LiveKit connection: ${participantRecord.id}`)
          }
        } catch (error) {
          console.error(`[Participant ${id}] Failed to create in DB:`, error)
        }
        
        // Публикуем фейковый аудио трек (требует браузерных API)
        publishFakeAudioTrack(room, id).catch(err => {
          console.warn(`[Participant ${id}] ⚠️  Failed to publish audio (expected in Node.js):`, err.message)
          // Не считаем это ошибкой в Node.js окружении
        })
      })

      room.on(RoomEvent.Disconnected, (reason?: string) => {
        participant.roomConnected = false
        console.log(`[Participant ${id}] Disconnected from LiveKit: ${reason || 'no reason'}`)
      })

      // Подключаемся к комнате
      await room.connect(serverUrl, token)
    } catch (error) {
      // LiveKit не работает в Node.js - это нормально, не считаем ошибкой
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('doesn\'t seem to be supported on this browser') || 
          errorMessage.includes('WebRTC') ||
          errorMessage.includes('browser')) {
        console.log(`[Participant ${id}] ℹ️  LiveKit skipped (requires browser environment, normal in Node.js)`)
      } else {
        console.warn(`[Participant ${id}] ⚠️  Failed to connect to LiveKit:`, errorMessage)
        // Только реальные ошибки считаем
      }
    }
  } else {
    // Тихо пропускаем, если не включено
  }

  // 3. Подключаемся к WebSocket транскрипции
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(transcriptionToken)}`)

    ws.on('open', () => {
      console.log(`[Participant ${id}] Connected to transcription WS`)
      participant.ws = ws
      participant.connected = true

      // Начинаем отправлять аудио чанки каждые 100ms
      const chunkInterval = setInterval(() => {
        if (participant.connected && ws.readyState === WebSocket.OPEN) {
          const chunk = generateAudioChunk()
          ws.send(chunk)
          participant.chunksSent++
        } else {
          clearInterval(chunkInterval)
        }
      }, 100)

      // Останавливаем через 30 секунд
      setTimeout(() => {
        clearInterval(chunkInterval)
      }, 30000)

      resolve(participant)
    })

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString())
        if (message.type === 'transcription' || message.transcript || message.text) {
          participant.transcriptsReceived++
          const latency = performance.now() - participant.startTime
          const text = message.text || message.transcript || message.message || ''
          console.log(`[Participant ${id}] ✅ Received transcript: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (latency: ${latency.toFixed(0)}ms)`)
        } else if (message.type === 'error' || message.type === 'warning') {
          participant.errors++
          console.error(`[Participant ${id}] ❌ Error:`, message.message || message.error || JSON.stringify(message))
        } else {
          // Логируем другие типы сообщений для отладки (только первые несколько)
          if (participant.transcriptsReceived < 3) {
            console.debug(`[Participant ${id}] 📨 Message:`, message.type || 'unknown', Object.keys(message))
          }
        }
      } catch (e) {
        // Игнорируем бинарные сообщения
      }
    })

    ws.on('error', (error) => {
      participant.errors++
      console.error(`[Participant ${id}] WebSocket error:`, error.message)
    })

    ws.on('close', (code, reason) => {
      participant.connected = false
      const reasonStr = reason ? reason.toString() : 'no reason'
      if (code !== 1000) { // 1000 = normal closure
        participant.errors++
        console.error(`[Participant ${id}] Transcription WS disconnected with code ${code}: ${reasonStr}`)
      } else {
        console.log(`[Participant ${id}] Transcription WS disconnected normally`)
      }
    })

    // Timeout на подключение
    setTimeout(() => {
      if (!participant.connected) {
        ws.close()
        // Не реджектим, т.к. LiveKit может быть подключен
        resolve(participant)
      }
    }, 5000)
  })
}

// Публикует фейковый аудио трек в LiveKit комнату (требует браузерных API)
async function publishFakeAudioTrack(room: any, participantId: string): Promise<void> {
  try {
    // Проверяем наличие браузерных API (AudioContext, MediaStream)
    if (typeof AudioContext === 'undefined' || typeof MediaStream === 'undefined') {
      console.warn(`[Participant ${participantId}] Browser APIs not available, skipping audio track publication`)
      return
    }

    // Создаем MediaStream с фейковым аудио
    const audioContext = new AudioContext({ sampleRate: 48000 })
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()

    oscillator.type = 'sine'
    oscillator.frequency.value = 440 // A4 note
    gainNode.gain.value = 0.1 // Низкая громкость, чтобы не мешать

    oscillator.connect(gainNode)
    gainNode.connect(destination)
    oscillator.start()

    const stream = destination.stream

    // Создаем локальный аудио трек из MediaStream
    const audioTrack = await createLocalAudioTrack(stream.getAudioTracks()[0])

    // Публикуем трек
    await room.localParticipant.publishTrack(audioTrack, {
      source: Track.Source.Microphone,
    })

    console.log(`[Participant ${participantId}] Published fake audio track to room`)

    // Останавливаем через время
    setTimeout(() => {
      oscillator.stop()
      audioContext.close()
    }, 60000)
  } catch (error) {
    console.error(`[Participant ${participantId}] Error publishing audio track:`, error)
    throw error
  }
}

async function getServerMetrics(): Promise<{ queueLength: number; totalQueued?: number; totalFlushed?: number; memory?: number }> {
  try {
    const http = await import('http')
    const metricsUrl = `http://${WS_HOST}:${WS_PORT}/metrics`
    
    return new Promise((resolve) => {
      const req = http.get(metricsUrl, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk.toString() })
        res.on('end', () => {
          try {
            const metrics = JSON.parse(data)
            resolve({
              queueLength: metrics.queue?.queueLength || 0,
              totalQueued: metrics.queue?.totalQueued || 0,
              totalFlushed: metrics.queue?.totalFlushed || 0,
              memory: process.memoryUsage().heapUsed / 1024 / 1024, // MB (локальная память теста)
            })
          } catch {
            resolve({ queueLength: 0 })
          }
        })
      })
      req.on('error', () => resolve({ queueLength: 0 }))
      req.setTimeout(2000, () => {
        req.destroy()
        resolve({ queueLength: 0 })
      })
    })
  } catch {
    return { queueLength: 0 }
  }
}

async function runLoadTest(participantCount: number = 15) {
  console.log(`\n🚀 Starting load test with ${participantCount} participants`)
  console.log(`📍 WebSocket URL: ${WS_URL}\n`)

  const participants: Participant[] = []
  const startTime = performance.now()

  const sessionSlug = process.env.TEST_SESSION_SLUG || 'load-test-session'
  
  // Сначала создаем тестовую сессию, если нужно
  console.log(`[Load Test] Using session slug: ${sessionSlug}`)
  console.log(`[Load Test] API URL: ${process.env.API_URL || 'http://localhost:3000'}\n`)
  
  // Получаем токены с задержкой между запросами (чтобы не упереться в rate limit)
  const tokenDataList: Array<{
    token: string
    serverUrl: string
    identity: string
    transcriptionToken: string
  } | null> = []
  
  for (let i = 0; i < participantCount; i++) {
    const identity = `load-test-participant-${i}`
    const name = `Load Test User ${i + 1}`
    const tokenData = await getTokenData(identity, sessionSlug)
    tokenDataList.push(tokenData)
    
    // Задержка 200ms между запросами (чтобы не упереться в rate limit)
    if (i < participantCount - 1 && tokenData) {
      await new Promise(resolve => setTimeout(resolve, 200))
    } else if (!tokenData) {
      // Если токен не получен, ждем дольше (возможно rate limit)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  const validTokenData = tokenDataList.filter((t): t is NonNullable<typeof t> => t !== null)
  
  if (validTokenData.length === 0) {
    console.error('\n❌ Failed to get any valid tokens from API!')
    console.error('\n📋 Troubleshooting:')
    console.error('  1. Make sure Next.js dev server is running: npm run dev')
    console.error('  2. Create a session first through the UI or use an existing one')
    console.error(`  3. Set TEST_SESSION_SLUG to match an existing session:`)
    console.error(`     export TEST_SESSION_SLUG=your-session-slug`)
    console.error('  4. If rate limited, wait 1 minute and try again')
    console.error('  5. Make sure you are authenticated (session exists)')
    console.error('\n💡 Tip: Create a session manually in the UI, then use its slug')
    process.exit(1)
  }
  
  if (validTokenData.length < participantCount) {
    console.warn(`\n⚠️  Got only ${validTokenData.length}/${participantCount} valid tokens`)
    console.warn('   Some participants may not connect due to rate limiting or missing session')
  } else {
    console.log(`✅ Got ${validTokenData.length}/${participantCount} valid tokens`)
  }
  console.log('')
  
  // Создаем участников с задержкой (чтобы не перегрузить сервер сразу)
  let participantIndex = 0
  for (let i = 0; i < participantCount; i++) {
    const identity = `load-test-participant-${i}`
    const name = `Load Test User ${i + 1}`
    const tokenData = tokenDataList[i]
    
    if (!tokenData) {
      console.warn(`⚠️  Skipping participant ${i}: no valid token`)
      continue
    }

    try {
      const participant = await createParticipant(
        identity,
        tokenData.identity,
        name,
        tokenData.token,
        tokenData.serverUrl,
        tokenData.transcriptionToken,
        sessionSlug
      )
      participants.push(participant)
      participantIndex++
      
      // Задержка 500ms между подключениями (LiveKit + WebSocket транскрипции)
      if (participantIndex < validTokenData.length) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`❌ Failed to create participant ${i}:`, errorMsg)
    }
  }

  console.log(`\n✅ ${participants.filter(p => p.connected).length}/${participantCount} participants connected\n`)

  // Мониторинг метрик каждые 5 секунд
  const metricsInterval = setInterval(async () => {
    const serverMetrics = await getServerMetrics()
    const connectedCount = participants.filter(p => p.connected).length
    const roomConnectedCount = participants.filter(p => p.roomConnected).length
    const participantsInDb = participants.filter(p => p.participantRecord).length
    const totalChunks = participants.reduce((sum, p) => sum + p.chunksSent, 0)
    const totalTranscripts = participants.reduce((sum, p) => sum + p.transcriptsReceived, 0)
    const totalErrors = participants.reduce((sum, p) => sum + p.errors, 0)

    console.log(`📊 Metrics (${new Date().toLocaleTimeString()}):`)
    console.log(`   ✅ Connected to transcription WS: ${connectedCount}/${participantCount}`)
    console.log(`   ${roomConnectedCount > 0 ? '✅' : 'ℹ️ '} Connected to LiveKit room: ${roomConnectedCount}/${participantCount} ${roomConnectedCount === 0 && ENABLE_LIVEKIT ? '(expected in Node.js)' : ''}`)
    if (participantsInDb > 0) {
      console.log(`   ✅ Participants in DB: ${participantsInDb}/${participantCount} (created after LiveKit connection)`)
    }
    console.log(`   📤 Chunks sent: ${totalChunks}`)
    console.log(`   📥 Transcripts received: ${totalTranscripts}${totalTranscripts === 0 ? ' (check WS server & Gladia)' : ''}`)
    console.log(`   ${totalErrors > 0 ? '⚠️' : '✅'} Errors: ${totalErrors}${totalErrors > 0 && roomConnectedCount === 0 && ENABLE_LIVEKIT ? ' (LiveKit errors are expected in Node.js)' : ''}`)
    console.log(`   Queue length: ${serverMetrics.queueLength}`)
    if (serverMetrics.totalQueued !== undefined) {
      console.log(`   Total queued: ${serverMetrics.totalQueued}`)
    }
    if (serverMetrics.totalFlushed !== undefined) {
      console.log(`   Total flushed: ${serverMetrics.totalFlushed}`)
    }
    if (serverMetrics.memory) {
      console.log(`   Memory (local): ${serverMetrics.memory.toFixed(2)} MB`)
    }
    console.log('')
  }, 5000)

  // Запускаем тест на 60 секунд
  await new Promise(resolve => setTimeout(resolve, 60000))

  clearInterval(metricsInterval)

  // Останавливаем всех участников
  console.log('\n🛑 Stopping participants...\n')
  for (const participant of participants) {
    if (participant.ws && participant.connected) {
      participant.ws.close()
    }
    if (participant.room && participant.roomConnected) {
      try {
        await participant.room.disconnect()
      } catch (error) {
        // Игнорируем ошибки при отключении
      }
    }
  }

  // Ждем закрытия соединений
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Финальная статистика
  const endTime = performance.now()
  const testDuration = (endTime - startTime) / 1000

  const totalChunks = participants.reduce((sum, p) => sum + p.chunksSent, 0)
  const totalTranscripts = participants.reduce((sum, p) => sum + p.transcriptsReceived, 0)
  const totalErrors = participants.reduce((sum, p) => sum + p.errors, 0)
  const avgLatency = participants.length > 0
    ? participants.reduce((sum, p) => sum + (performance.now() - p.startTime), 0) / participants.length
    : 0

  const finalServerMetrics = await getServerMetrics()

  const metrics: TestMetrics = {
    totalParticipants: participantCount,
    connectedParticipants: participants.filter(p => p.connected).length,
    totalChunksSent: totalChunks,
    totalTranscriptsReceived: totalTranscripts,
    totalErrors,
    avgLatency,
    testDuration,
    queueLength: finalServerMetrics.queueLength,
    memoryUsage: finalServerMetrics.memory,
  }

  console.log('\n📈 Final Test Results:')
  console.log('='.repeat(50))
  console.log(`Total participants: ${metrics.totalParticipants}`)
  console.log(`Connected: ${metrics.connectedParticipants}`)
  console.log(`Test duration: ${metrics.testDuration.toFixed(1)}s`)
  console.log(`Total chunks sent: ${metrics.totalChunksSent}`)
  console.log(`Total transcripts received: ${metrics.totalTranscriptsReceived}`)
  console.log(`Total errors: ${metrics.totalErrors}`)
  console.log(`Average latency: ${metrics.avgLatency.toFixed(0)}ms`)
  console.log(`Queue length: ${metrics.queueLength}`)
  if (finalServerMetrics.totalQueued !== undefined) {
    console.log(`Total queued: ${finalServerMetrics.totalQueued}`)
  }
  if (finalServerMetrics.totalFlushed !== undefined) {
    console.log(`Total flushed: ${finalServerMetrics.totalFlushed}`)
  }
  if (metrics.memoryUsage) {
    console.log(`Memory usage (local): ${metrics.memoryUsage.toFixed(2)} MB`)
  }
  console.log('='.repeat(50))
  console.log('\n💡 Check Sentry dashboard and server logs for errors\n')

  return metrics
}

// Запуск теста
const participantCount = parseInt(process.argv[2]) || 15
runLoadTest(participantCount)
  .then(() => {
    console.log('✅ Load test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Load test failed:', error)
    process.exit(1)
  })


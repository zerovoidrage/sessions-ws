# Лайв транскрипция — Техническая документация

## 📋 Содержание

1. [Обзор системы](#обзор-системы)
2. [Используемые сервисы и инфраструктура](#используемые-сервисы-и-инфраструктура)
3. [Архитектура процесса транскрипции](#архитектура-процесса-транскрипции)
4. [Основные компоненты кода](#основные-компоненты-кода)
5. [Текущие проблемы и решения](#текущие-проблемы-и-решения)
6. [Поток данных (детально)](#поток-данных-детально)

---

## Обзор системы

### Что делаем

**Лайв транскрипция** — это система для преобразования речи в текст в реальном времени во время видеозвонков.

**Основные возможности:**
- ✅ Транскрипция речи всех участников сессии в реальном времени
- ✅ Отображение транскриптов в интерфейсе (partial и final)
- ✅ Определение активного спикера (speaker diarization)
- ✅ Сохранение финальных транскриптов в базу данных
- ✅ Учёт использования и стоимости транскрипции

**Модель работы:**
- **Server-Side транскрипция** (текущая реализация)
- Один поток транскрипции на сессию (не на участника)
- Микширование аудио на стороне LiveKit
- Централизованная обработка через RTMP → FFmpeg → Gladia

---

## Используемые сервисы и инфраструктура

### Внешние сервисы

#### 1. **LiveKit Cloud** (WebRTC сервер)
- **Назначение:** Видеозвонки, WebRTC соединения
- **Использование:**
  - Подключение участников к комнатам (сессиям)
  - Публикация аудио/видео треков
  - **Room Composite Egress** — получение микшированного аудио потока для транскрипции
- **API:** `livekit-server-sdk` (Node.js)
- **Конфигурация:**
  - `LIVEKIT_HTTP_URL` — URL LiveKit сервера
  - `LIVEKIT_API_KEY` — API ключ
  - `LIVEKIT_API_SECRET` — API секрет

#### 2. **Gladia API** (Speech-to-Text)
- **Назначение:** Транскрипция аудио в текст в реальном времени
- **Использование:**
  - **Gladia Live v2 API** — WebSocket для real-time транскрипции
  - Принимает PCM16 аудио (16kHz, mono)
  - Возвращает partial и final транскрипты
- **API:** WebSocket (`wss://api.gladia.io/v2/live`)
- **Конфигурация:**
  - `GLADIA_API_KEY` — API ключ для Gladia
- **Ограничения:**
  - Gladia Live v2 не даёт полноценной diarization в real-time
  - Diarization доступна только в file-based API (post-call analysis)
  - Поэтому используем active-speaker-tracker из LiveKit как основной источник

#### 3. **Neon PostgreSQL** (База данных)
- **Назначение:** Хранение сессий, участников, транскриптов, метрик
- **Использование:**
  - `VideoSession` — сессии
  - `Participant` — участники сессий
  - `TranscriptSegment` — финальные транскрипты
  - `TranscriptionUsage` — метрики использования
- **ORM:** Prisma
- **Конфигурация:**
  - `DATABASE_URL` — connection string для PostgreSQL

### Инфраструктура (Railway)

#### Сервис 1: **WebSocket Server** (`SERVER_MODE=ws`)

**Назначение:** Обработка клиентских WebSocket подключений для получения транскриптов.

**Что делает:**
1. ✅ Принимает WebSocket подключения от фронтенда
2. ✅ Валидирует JWT токены для авторизации
3. ✅ Регистрирует клиентов для сессий
4. ✅ Принимает транскрипты от RTMP сервера через HTTP API
5. ✅ Broadcast транскриптов всем подключенным клиентам сессии
6. ✅ Управляет запуском транскрипции (вызывает LiveKit Egress API)
7. ✅ Обрабатывает активных спикеров через HTTP API

**Endpoints:**
- `ws://domain/api/realtime/transcribe` — WebSocket для получения транскриптов
- `POST /api/transcription/start` — запуск серверной транскрипции
- `POST /api/transcription/stop` — остановка транскрипции
- `POST /api/realtime/transcribe/broadcast` — **межсервисный endpoint** для приема транскриптов от RTMP сервера
- `POST /api/active-speaker` — обновление активного спикера
- `GET /health` — health check
- `GET /metrics` — метрики сервера

**Порты:**
- HTTP/WebSocket: порт, назначенный Railway автоматически (обычно 8080)
- **НЕ** запускает RTMP сервер

**Переменные окружения:**
```bash
SERVER_MODE=ws
WS_BASE_URL=https://ws-production-dbcc.up.railway.app  # URL этого сервиса
RTMP_SERVER_URL=https://rtmp-service.up.railway.app  # URL RTMP сервера
RTMP_SERVER_SECRET=shared-secret                     # Секрет для межсервисной связи
DATABASE_URL=...
LIVEKIT_HTTP_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
TRANSCRIPTION_JWT_SECRET=...
GLADIA_API_KEY=...  # Нужен для запуска транскрипции (создание Egress)
```

**Networking (Railway):**
- **Public Networking:** `Default / Auto-detect`
- Railway автоматически назначает порт для HTTP/WebSocket
- ❌ **НЕ** устанавливать Custom Port

---

#### Сервис 2: **RTMP Server** (`SERVER_MODE=rtmp`)

**Назначение:** Прием RTMP потоков от LiveKit Egress, декодирование аудио и транскрипция через Gladia.

**Что делает:**
1. ✅ Слушает RTMP порт (1937) через TCP Proxy
2. ✅ Принимает RTMP поток от LiveKit Room Composite Egress
3. ✅ Декодирует аудио через FFmpeg (RTMP → PCM16)
4. ✅ Отправляет аудио в Gladia API для транскрипции
5. ✅ Получает транскрипты от Gladia
6. ✅ Отправляет транскрипты в WebSocket сервер через HTTP POST
7. ✅ Сохраняет финальные транскрипты в базу данных

**Endpoints:**
- RTMP: `rtmp://tcp-proxy-host:port/live/{sessionSlug}` — прием RTMP потока
- **НЕТ** HTTP endpoints (только RTMP)

**Порты:**
- RTMP: 1937 (через TCP Proxy Railway)
- **НЕ** запускает HTTP/WebSocket сервер

**Переменные окружения:**
```bash
SERVER_MODE=rtmp
RTMP_PORT=1937
RTMP_HOST=region.proxy.rlwy.net              # TCP прокси хост
RTMP_EXTERNAL_PORT=XXXXX                    # TCP прокси порт
WS_SERVER_URL=https://ws-service.up.railway.app  # URL WebSocket сервера
RTMP_SERVER_SECRET=shared-secret            # ТОТ ЖЕ секрет, что на WS сервере
GLADIA_API_KEY=...
DATABASE_URL=...
LIVEKIT_HTTP_URL=...  # Может понадобиться для дополнительной логики
```

**Networking (Railway):**
- **TCP Proxy:** порт `1937`
- Railway предоставляет TCP прокси URL (например: `region.proxy.rlwy.net:XXXXX`)
- ❌ **НЕ** нужен Public Networking

---

## Архитектура процесса транскрипции

### Общая схема

```
┌─────────────────────────────────────────────────────────┐
│                    Клиент (Браузер)                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  WebSocket: wss://ws-service/.../transcribe     │  │
│  │  - Подключение для получения транскриптов       │  │
│  │  - Отправка active speaker events               │  │
│  └──────────────────────────────────────────────────┘  │
│                        ↕                                │
└─────────────────────────┼───────────────────────────────┘
                          │
                          │ wss://
                          ↓
┌─────────────────────────────────────────────────────────┐
│        Service 1: WebSocket Server (PORT=8080)          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  • WebSocket connections                         │  │
│  │  • Client registration                           │  │
│  │  • Broadcast transcripts                         │  │
│  │  • Start/Stop transcription (LiveKit Egress)    │  │
│  └──────────────────────────────────────────────────┘  │
│                        ↕                                │
│                  HTTP POST /api/realtime/transcribe/broadcast
│                        ↕                                │
└─────────────────────────┼───────────────────────────────┘
                          │
                          │ HTTP
                          ↓
┌─────────────────────────────────────────────────────────┐
│          Service 2: RTMP Server (PORT=1937)             │
│  ┌──────────────────────────────────────────────────┐  │
│  │  • RTMP ingestion (TCP Proxy)                   │  │
│  │  • FFmpeg decoding (RTMP → PCM16)               │  │
│  │  • Gladia transcription                         │  │
│  │  • Send transcripts to WS server                │  │
│  └──────────────────────────────────────────────────┘  │
│                        ↕                                │
│                  RTMP stream                           │
│                        ↕                                │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ↑
                          │ RTMP
                          │
┌─────────────────────────────────────────────────────────┐
│                  LiveKit Egress                         │
│                                                         │
│  Room Composite Egress → RTMP stream                   │
│  (микшированное аудио всех участников)                  │
└─────────────────────────────────────────────────────────┘
```

### Поток данных (пошагово)

#### 1. Инициализация сессии

```
Клиент → GET /api/sessions/[slug]/token
  ↓
Next.js API Route
  ↓
- Получает сессию из БД по slug
- Генерирует LiveKit AccessToken
- Генерирует transcription JWT токен
  ↓
Response: {
  token: "livekit-jwt-token",
  transcriptionToken: "jwt-for-websocket",
  sessionCreatedByUserId: "user-id"
}
```

#### 2. Подключение к LiveKit комнате

```
Клиент → Room.connect(serverUrl, token)
  ↓
LiveKit Cloud (WebRTC)
  ↓
- Проверка токена
- Создание/найден комнаты (roomName = sessionSlug)
- Регистрация участника
- Установка WebRTC соединения
  ↓
RoomEvent.Connected
  ↓
localParticipant доступен
```

#### 3. Подключение к WebSocket серверу

```
Клиент → WebSocket.connect(ws://ws-service/api/realtime/transcribe?token=<JWT>)
  ↓
WebSocket Server (ws-server/server/index.ts)
  ↓
1. Валидация JWT токена (verifyTranscriptionToken)
2. Извлечение sessionSlug, participantIdentity
3. Регистрация клиента для сессии
4. Отправка initial message: {"type": "connected", ...}
  ↓
Клиент зарегистрирован и готов получать транскрипты
```

#### 4. Запуск серверной транскрипции

```
Клиент → POST /api/transcription/start
  Body: { sessionId, sessionSlug }
  ↓
WebSocket Server
  ↓
startServerTranscription({ sessionId, sessionSlug })
  ↓
startRoomCompositeTranscription()
  ↓
1. Создание RTMP Ingest (на RTMP сервере, если не в split mode)
2. Запуск LiveKit Room Composite Egress:
   - EgressClient.startRoomCompositeEgress()
   - Audio-only режим
   - RTMP выход: rtmp://rtmp-host:port/live/{sessionSlug}
  ↓
LiveKit начинает стримить микшированное аудио в RTMP
```

#### 5. Прием RTMP потока

```
LiveKit Egress → RTMP stream → rtmp://rtmp-host:port/live/{sessionSlug}
  ↓
RTMP Server (ws-server/server/rtmp-server.ts)
  ↓
1. RTMP сервер принимает поток
2. Вызывается onStreamStart callback
3. Запускается FFmpeg decoder:
   - ffmpeg -i rtmp://localhost:1937/live/{sessionSlug}
   - Декодирование: RTMP → PCM16 (16kHz, mono)
   - Вывод в stdout (pipe:1)
```

#### 6. Декодирование и отправка в Gladia

```
FFmpeg → PCM16 chunks (stdout)
  ↓
RTMP Ingest (ws-server/server/rtmp-ingest.ts)
  ↓
1. Чтение PCM16 данных из FFmpeg stdout
2. Создание GladiaBridge (если еще не создан)
3. Отправка PCM16 чанков в Gladia WebSocket
  ↓
GladiaBridge.sendAudio(chunk)
  ↓
Gladia WebSocket (wss://api.gladia.io/v2/live)
```

#### 7. Транскрипция в Gladia

```
Gladia API
  ↓
- Обработка PCM16 аудио
- Распознавание речи (STT)
- Генерация partial transcripts (драфты)
- Генерация final transcripts (финальные сегменты)
  ↓
Gladia → WebSocket Server:
  {
    type: 'transcript',
    data: {
      id: 'utterance-id',
      is_final: false/true,
      utterance: { text: '...' }
    }
  }
```

#### 8. Получение транскриптов и broadcast

```
Gladia → RTMP Server (GladiaBridge)
  ↓
handleTranscript(event: TranscriptEvent)
  ↓
1. Получение активного спикера (getActiveSpeaker)
2. Формирование payload:
   {
     sessionSlug,
     utteranceId,
     text,
     isFinal,
     speaker: activeSpeaker.identity,
     speakerId: activeSpeaker.identity,
     ts: Date.now()
   }
3. Отправка в WebSocket сервер:
   HTTP POST /api/realtime/transcribe/broadcast
  ↓
WebSocket Server (ws-server/server/broadcast.ts)
  ↓
1. Получение всех клиентов сессии (getClientsForSession)
2. Broadcast транскрипта всем клиентам:
   ws.send(JSON.stringify(payload))
  ↓
Клиенты получают транскрипты через WebSocket
```

#### 9. Сохранение в БД

```
Только финальные транскрипты (isFinal: true):
  ↓
appendTranscriptChunk() (ws-server/server/append-transcript-chunk.ts)
  ↓
1. Получение сессии по slug
2. Создание/обновление Participant (по identity)
3. upsert TranscriptSegment (по videoSessionId + utteranceId)
  ↓
БД (PostgreSQL):
  - VideoSession (существующая сессия)
  - Participant (создаётся при первом транскрипте)
  - TranscriptSegment (финальный сегмент)
```

---

## Основные компоненты кода

### 1. WebSocket Server (`ws-server/server/index.ts`)

**Ответственность:** Главный HTTP/WebSocket сервер.

**Ключевые части:**

```typescript
// Определение режима работы
const SERVER_MODE = process.env.SERVER_MODE // 'ws' | 'rtmp' | undefined

// Условное создание WebSocket серверов
if (SERVER_MODE !== 'rtmp') {
  wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // Важно для Railway proxy
  })
}

// Обработка upgrade запросов
server.on('upgrade', (req, socket, head) => {
  // Валидация токена
  const authResult = validateTokenAndSession(token, sessionSlug)
  
  // Upgrade к WebSocket
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

// Endpoint для запуска транскрипции
if (pathname?.startsWith('/api/transcription/start')) {
  // Асинхронный запуск (не блокируем ответ)
  startServerTranscription({ sessionId, sessionSlug })
}
```

**Файл:** `ws-server/server/index.ts`

---

### 2. LiveKit Transcriber (`ws-server/server/livekit-transcriber.ts`)

**Ответственность:** Управление серверной транскрипцией через LiveKit Egress.

**Ключевые части:**

```typescript
export async function startServerTranscription(
  options: StartServerTranscriptionOptions
): Promise<ServerTranscriber> {
  const { sessionId, sessionSlug } = options
  
  // Используем Room Composite Egress (предпочтительно)
  const { startRoomCompositeTranscription } = await import('./livekit-room-composite-transcriber.js')
  
  const transcriber = await startRoomCompositeTranscription({
    sessionId,
    sessionSlug,
    rtmpHost: process.env.RTMP_HOST || 'localhost',
    rtmpPort: parseInt(process.env.RTMP_EXTERNAL_PORT || '1937', 10),
  })
  
  return transcriber
}
```

**Файл:** `ws-server/server/livekit-transcriber.ts`

---

### 3. Room Composite Transcriber (`ws-server/server/livekit-room-composite-transcriber.ts`)

**Ответственность:** Запуск LiveKit Room Composite Egress и создание RTMP Ingest.

**Ключевые части:**

```typescript
export async function startRoomCompositeTranscription(
  options: StartRoomCompositeTranscriptionOptions
): Promise<RoomCompositeTranscriber> {
  const { sessionId, sessionSlug, rtmpHost, rtmpPort } = options
  
  const egressClient = new EgressClient(
    livekitConfig.httpUrl,
    livekitConfig.apiKey,
    livekitConfig.apiSecret
  )
  
  // RTMP URL для приема потока
  const rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}/live/${sessionSlug}`
  
  // Создаем RTMP Ingest (если не в split mode)
  const isSplitMode = process.env.SERVER_MODE === 'ws'
  let rtmpIngest: RTMPIngest | null = null
  
  if (!isSplitMode) {
    rtmpIngest = await createRTMPIngest({
      sessionId,
      sessionSlug,
      rtmpPort: internalPort,
    })
  }
  
  // Запускаем Room Composite Egress
  const streamOutput = new StreamOutput({
    protocol: StreamProtocol.RTMP,
    urls: [rtmpUrl],
  })
  
  const egressInfo = await egressClient.startRoomCompositeEgress(
    sessionSlug,
    streamOutput,
    { audioOnly: true }
  )
  
  return new RoomCompositeTranscriberImpl(...)
}
```

**Файл:** `ws-server/server/livekit-room-composite-transcriber.ts`

---

### 4. RTMP Ingest (`ws-server/server/rtmp-ingest.ts`)

**Ответственность:** Прием RTMP потока, декодирование через FFmpeg, отправка в Gladia.

**Ключевые части:**

```typescript
class RTMPIngestImpl {
  private async startFFmpegDecoder(): Promise<void> {
    // FFmpeg команда для декодирования RTMP → PCM16
    const ffmpegArgs = [
      '-rtmp_live', 'live',
      '-i', this.rtmpUrl, // RTMP поток
      '-vn', // Отключаем видео
      '-acodec', 'pcm_s16le', // PCM16
      '-ar', '16000', // 16kHz
      '-ac', '1', // Моно
      '-f', 's16le', // Raw PCM16
      'pipe:1', // Вывод в stdout
    ]
    
    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs)
    
    // Чтение PCM16 данных из stdout
    this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      if (this.gladiaBridge && chunk.length > 0) {
        this.gladiaBridge.sendAudio(chunk)
      }
    })
  }
  
  private handleTranscript(event: TranscriptEvent): void {
    // Получаем активного спикера
    const activeSpeaker = getActiveSpeaker(this.config.sessionSlug)
    const speakerIdentity = activeSpeaker?.identity || event.speakerId || 'room'
    
    // Отправляем транскрипт в WebSocket сервер
    this.sendTranscriptToWebSocketServer(this.config.sessionSlug, {
      sessionSlug: this.config.sessionSlug,
      utteranceId: event.utteranceId,
      text: event.text,
      isFinal: event.isFinal,
      speaker: speakerIdentity,
      speakerId: speakerIdentity,
      ts: Date.now(),
    })
    
    // Сохраняем финальные транскрипты в БД
    if (event.isFinal) {
      appendTranscriptChunk({...})
    }
  }
}
```

**Файл:** `ws-server/server/rtmp-ingest.ts`

---

### 5. Gladia Bridge (`ws-server/server/gladia-bridge.ts`)

**Ответственность:** Обёртка над Gladia Live v2 WebSocket API.

**Ключевые части:**

```typescript
export async function createGladiaBridge(): Promise<GladiaBridge> {
  const apiKey = getGladiaApiKey()
  
  // Инициализация сессии через POST /v2/live
  const websocketUrl = await initGladiaSession(apiKey)
  
  // Подключение к WebSocket
  const gladiaWs = new WebSocket(websocketUrl)
  
  gladiaWs.on('message', (data: Buffer | string) => {
    const message: GladiaMessage = JSON.parse(data.toString())
    
    // Парсим транскрипты
    const transcriptEvent = parseTranscriptMessage(message)
    
    if (transcriptEvent && transcriptCallback) {
      transcriptCallback(transcriptEvent)
    }
  })
  
  return {
    sendAudio(chunk: ArrayBuffer | Buffer) {
      if (isReady && gladiaWs.readyState === WebSocket.OPEN) {
        gladiaWs.send(chunk)
      }
    },
    onTranscript(cb: (event: TranscriptEvent) => void) {
      transcriptCallback = cb
    },
    close() {
      gladiaWs.close()
    },
  }
}
```

**Файл:** `ws-server/server/gladia-bridge.ts`

---

### 6. Client Connection (`ws-server/server/client-connection.ts`)

**Ответственность:** Управление клиентскими WebSocket подключениями.

**Ключевые части:**

```typescript
// Хранилище клиентов по сессиям
const sessionClients = new Map<string, Set<WsClientMeta>>()

export function registerClientForSession(
  sessionSlug: string,
  ws: WebSocket,
  meta?: { userId?: string }
): void {
  const clientMeta: WsClientMeta = {
    ws,
    sessionSlug,
    userId: meta?.userId,
    connectedAt: Date.now(),
  }
  
  const clients = sessionClients.get(sessionSlug) || new Set()
  clients.add(clientMeta)
  sessionClients.set(sessionSlug, clients)
}

export function broadcastToSessionClients(
  sessionSlug: string,
  payload: any
): void {
  const clients = sessionClients.get(sessionSlug)
  if (!clients || clients.size === 0) {
    return
  }
  
  const message = JSON.stringify(payload)
  
  for (const clientMeta of clients) {
    if (clientMeta.ws.readyState === WebSocket.OPEN) {
      clientMeta.ws.send(message)
    }
  }
}
```

**Файл:** `ws-server/server/client-connection.ts`

---

### 7. Active Speaker Tracker (`ws-server/server/active-speaker-tracker.ts`)

**Ответственность:** Отслеживание активных спикеров для каждой сессии.

**Ключевые части:**

```typescript
// Хранилище активных спикеров
const activeSpeakers = new Map<string, {
  identity: string
  name?: string
  timestamp: number
}>()

export function updateActiveSpeaker(event: ActiveSpeakerEvent): void {
  const { sessionSlug, participantIdentity, participantName, timestamp } = event
  
  // Обновляем только если это более свежее событие
  const current = activeSpeakers.get(sessionSlug)
  if (!current || timestamp > current.timestamp) {
    activeSpeakers.set(sessionSlug, {
      identity: participantIdentity,
      name: participantName,
      timestamp,
    })
  }
}

export function getActiveSpeaker(sessionSlug: string): {
  identity: string
  name?: string
  timestamp: number
} | null {
  return activeSpeakers.get(sessionSlug) || null
}
```

**Файл:** `ws-server/server/active-speaker-tracker.ts`

---

## Текущие проблемы и решения

### 🔴 Проблема 1: WebSocket закрывается сразу после подключения

#### Симптомы:

1. **WebSocket подключение устанавливается успешно:**
   ```
   ✅ WebSocket connection established
   ✅ Initial message sent to client
   ```

2. **Но сразу закрывается:**
   ```
   ❌ Client disconnected
   code: 1006 (Abnormal Closure)
   reason: 'no reason'
   ```

3. **Ошибка в браузере:**
   ```
   WebSocket connection to 'wss://ws-production-dbcc.up.railway.app/...' 
   failed: Invalid frame header
   ```

#### Что происходит:

1. **Handshake проходит успешно:**
   - Браузер отправляет HTTP запрос с заголовками `Upgrade: websocket`
   - Railway проксирует запрос в WebSocket сервер
   - Сервер отвечает `101 Switching Protocols`
   - Соединение устанавливается (`readyState: 1`)

2. **Сервер отправляет initial message:**
   - Отправляется JSON сообщение: `{"type": "connected", ...}`
   - Но браузер получает "Invalid frame header"

3. **Соединение закрывается:**
   - Браузер закрывает соединение (код 1006 = Abnormal Closure)
   - Это означает, что close frame не был получен нормально

#### Гипотезы:

1. **Railway proxy модифицирует WebSocket поток**
   - Railway может сжимать/модифицировать данные
   - **Решение:** Отключили `perMessageDeflate: false`

2. **Слишком ранняя отправка сообщения**
   - Сообщение отправляется до полного завершения upgrade
   - **Решение:** Ждем события `'open'` перед отправкой

3. **Railway proxy закрывает "пустые" соединения**
   - Proxy может закрывать соединения, которые не обмениваются данными быстро
   - **Решение:** Отправляем initial message сразу после подключения

4. **HTTP обработчик перехватывает WebSocket запросы**
   - Возможно, HTTP endpoint пытается обработать WebSocket запрос
   - **Решение:** Используем `noServer: true` и явную обработку upgrade

#### Что проверено:

- ✅ Upgrade запрос доходит до сервера (логи показывают `Upgrade request received`)
- ✅ WebSocket соединение устанавливается (`readyState: 1` в логах)
- ✅ Initial message отправляется (логи показывают `Initial message sent`)
- ❌ Но сразу после этого соединение закрывается (`code: 1006`)

#### Реализованные исправления:

1. **Ожидание события 'open':**
   ```typescript
   // ws-server/server/ws-handlers.ts
   ws.once('open', () => {
     if (ws.readyState === WebSocket.OPEN) {
       const message = JSON.stringify({
         type: 'connected',
         sessionSlug,
         message: 'WebSocket connection established',
         ts: Date.now(),
       })
       ws.send(message)
     }
   })
   ```

2. **Отключение perMessageDeflate:**
   ```typescript
   // ws-server/server/index.ts
   wss = new WebSocketServer({
     noServer: true,
     perMessageDeflate: false, // Важно для Railway proxy
   })
   ```

3. **Явная обработка upgrade:**
   ```typescript
   // ws-server/server/index.ts
   server.on('upgrade', (req, socket, head) => {
     // Валидация токена ДО upgrade
     const authResult = validateTokenAndSession(token, sessionSlug)
     if (!authResult.ok) {
       socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
       socket.destroy()
       return
     }
     
     // Передаем управление WebSocketServer
     wss.handleUpgrade(req, socket, head, (ws) => {
       wss.emit('connection', ws, req)
     })
   })
   ```

4. **Ping/pong для поддержания соединения:**
   ```typescript
   // ws-server/server/ws-handlers.ts
   const pingInterval = setInterval(() => {
     if (ws.readyState === WebSocket.OPEN) {
       ws.ping()
     }
   }, 30000) // Каждые 30 секунд
   ```

#### Что нужно проверить дальше:

1. **Логи Railway при закрытии:**
   - Что именно отправляется перед закрытием?
   - Есть ли ошибки в логах сервера?

2. **Тест через `wscat`:**
   ```bash
   npx wscat -c "wss://ws-production-dbcc.up.railway.app/api/realtime/transcribe?token=..."
   ```
   - Если `wscat` тоже падает — проблема на сервере
   - Если работает — проблема в браузере или CORS

3. **Проверка HTTP endpoint:**
   ```bash
   curl -i "https://ws-production-dbcc.up.railway.app/api/realtime/transcribe"
   ```
   - Если возвращает HTTP (не ошибку 426) — endpoint обрабатывается как HTTP

---

### ⚠️ Проблема 2: Разделение сервисов (WebSocket и RTMP)

#### Контекст:

Первоначально WebSocket сервер и RTMP сервер работали в одном процессе, что вызывало конфликты портов в Railway:
- Railway автоматически назначал порт для HTTP/WebSocket
- Этот порт иногда совпадал с RTMP портом (1937)
- В результате RTMP сервер не мог запуститься или HTTP сервер занимал неправильный порт

#### Решение:

Разделили на два независимых сервиса с четким разделением ответственности:

1. **WebSocket Server** (`SERVER_MODE=ws`)
   - Только HTTP/WebSocket endpoints
   - Управление клиентскими подключениями
   - Broadcast транскриптов
   - Запуск транскрипции (вызов LiveKit Egress API)

2. **RTMP Server** (`SERVER_MODE=rtmp`)
   - Только RTMP сервер (порт 1937 через TCP Proxy)
   - Прием RTMP потоков от LiveKit Egress
   - Декодирование через FFmpeg
   - Транскрипция через Gladia
   - Отправка транскриптов в WebSocket сервер через HTTP

#### Межсервисная связь:

**RTMP → WebSocket (HTTP POST):**
```typescript
// ws-server/server/rtmp-ingest.ts
const wsServerUrl = process.env.WS_SERVER_URL
const postData = JSON.stringify({
  sessionSlug,
  utteranceId,
  text,
  isFinal,
  speaker,
  speakerId,
  ts: Date.now(),
})

const req = http.request({
  hostname: new URL(wsServerUrl).hostname,
  port: new URL(wsServerUrl).port || 443,
  path: '/api/realtime/transcribe/broadcast',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${RTMP_SERVER_SECRET}`, // Опционально
  },
})

req.write(postData)
req.end()
```

**WebSocket Server (прием транскриптов):**
```typescript
// ws-server/server/index.ts
if (pathname === '/api/realtime/transcribe/broadcast' && req.method === 'POST') {
  // Проверка авторизации (опционально)
  const authHeader = req.headers.authorization
  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    res.statusCode = 401
    return
  }
  
  // Broadcast транскрипта клиентам
  broadcastToSessionClients(sessionSlug, payload)
}
```

---

## Поток данных (детально)

### Полный цикл транскрипции

```
1. Клиент подключается к LiveKit комнате
   └─ Room.connect(serverUrl, token)
   └─ localParticipant доступен

2. Клиент подключается к WebSocket серверу
   └─ WebSocket.connect(ws://ws-service/api/realtime/transcribe?token=<JWT>)
   └─ Клиент зарегистрирован для сессии

3. Клиент запускает транскрипцию
   └─ POST /api/transcription/start
   └─ WebSocket Server вызывает startServerTranscription()

4. WebSocket Server запускает LiveKit Egress
   └─ startRoomCompositeTranscription()
   └─ EgressClient.startRoomCompositeEgress()
   └─ LiveKit начинает стримить RTMP

5. RTMP Server принимает поток
   └─ RTMP сервер получает поток на rtmp://localhost:1937/live/{sessionSlug}
   └─ onStreamStart callback
   └─ Запускается FFmpeg decoder

6. FFmpeg декодирует аудио
   └─ RTMP → PCM16 (16kHz, mono)
   └─ Вывод в stdout

7. RTMP Ingest отправляет в Gladia
   └─ Чтение PCM16 из FFmpeg stdout
   └─ GladiaBridge.sendAudio(chunk)
   └─ Gladia WebSocket получает аудио

8. Gladia обрабатывает аудио
   └─ Распознавание речи (STT)
   └─ Генерация partial/final транскриптов
   └─ Отправка транскриптов обратно

9. RTMP Server получает транскрипты
   └─ GladiaBridge.onTranscript callback
   └─ handleTranscript() получает активного спикера
   └─ Отправка в WebSocket сервер через HTTP POST

10. WebSocket Server broadcast транскриптов
    └─ POST /api/realtime/transcribe/broadcast
    └─ broadcastToSessionClients()
    └─ Все клиенты сессии получают транскрипт

11. Клиенты отображают транскрипты
    └─ WebSocket.onmessage
    └─ Обновление UI

12. Сохранение в БД (только final)
    └─ appendTranscriptChunk()
    └─ upsert TranscriptSegment
```

---

## Резюме

### Что работает:

✅ **Server-Side транскрипция:**
- Один поток транскрипции на сессию (не на участника)
- Микширование аудио на стороне LiveKit
- Централизованная обработка через RTMP → FFmpeg → Gladia

✅ **Разделение сервисов:**
- WebSocket Server и RTMP Server работают независимо
- Межсервисная связь через HTTP API
- Безопасность через shared secret

✅ **Определение активного спикера:**
- Active-speaker-tracker из LiveKit (основной источник)
- Gladia speakerId как fallback (хотя Gladia Live v2 не дает полноценной diarization)

✅ **Сохранение транскриптов:**
- Только финальные транскрипты сохраняются в БД
- Partial транскрипты только для real-time отображения

### Текущие проблемы:

⚠️ **WebSocket закрывается сразу после подключения:**
- Ошибка "Invalid frame header" в браузере
- Соединение закрывается с кодом 1006 (Abnormal Closure)
- Возможная причина: Railway proxy модифицирует WebSocket поток
- Реализованы исправления (ожидание 'open', отключение perMessageDeflate)

### Следующие шаги:

1. **Проверить исправления WebSocket:**
   - Тест через `wscat`
   - Проверка логов Railway при закрытии
   - Проверка HTTP endpoint

2. **Мониторинг:**
   - Отслеживание метрик WebSocket сервера
   - Алерты при превышении лимитов
   - Логирование ошибок

3. **Оптимизация:**
   - Batch insert для транскриптов в БД
   - Кэширование статистики
   - Улучшение обработки ошибок

---

*Документ обновлён: 2024-12-01*


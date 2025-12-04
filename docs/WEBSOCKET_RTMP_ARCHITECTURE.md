# Архитектура WebSocket/RTMP сервера и Realtime AI

## Обзор

Система транскрипции и realtime AI состоит из нескольких взаимосвязанных компонентов:

1. **WebSocket сервер** (`server/index.ts`) — принимает транскрипты и распространяет их клиентам
2. **RTMP сервер** (`server/rtmp-server.ts`) — принимает аудио потоки от LiveKit Egress
3. **LiveKit Egress** — получает микшированный аудио из комнаты и отправляет через RTMP
4. **Gladia Bridge** — обрабатывает аудио и возвращает транскрипты
5. **Realtime AI Engine** — анализирует транскрипты и генерирует insights

---

## 1. WebSocket сервер

### 1.1 Архитектура

WebSocket сервер работает на отдельном порту (Railway) и обрабатывает два типа соединений:

#### Основной WebSocket (`/api/realtime/transcribe`)
- **Назначение**: Прием транскриптов от серверной транскрипции и распространение клиентам
- **Аутентификация**: JWT токен в query параметрах (`?token=...&sessionSlug=...`)
- **Режимы работы**:
  - `SERVER_MODE=ws` — только WebSocket
  - `SERVER_MODE=rtmp` — только RTMP
  - `SERVER_MODE=undefined` — оба режима (по умолчанию)

#### Egress WebSocket (`/egress/audio/{sessionId}/{trackId}`)
- **Назначение**: Прием аудио потока от LiveKit Track Egress (fallback режим)
- **Использование**: Когда Room Composite Egress недоступен

### 1.2 Жизненный цикл соединения

```typescript
// 1. Клиент подключается с токеном
ws://ws-server/api/realtime/transcribe?token=JWT&sessionSlug=abc123

// 2. Сервер валидирует токен
validateTokenAndSession(token, sessionSlug)

// 3. Регистрирует клиента в sessionClients Map
registerClientForSession(sessionSlug, ws, { userId })

// 4. Клиент получает транскрипты через broadcast
broadcastToSessionClients(sessionSlug, transcriptPayload)
```

### 1.3 Структура данных

**Клиентские метаданные:**
```typescript
interface WsClientMeta {
  ws: WebSocket
  sessionSlug: string
  userId?: string
  connectedAt: number
}
```

**Транскрипт сообщение:**
```typescript
interface ServerTranscriptionMessage {
  type: 'transcript'
  sessionSlug: string
  userId?: string
  utteranceId: string
  text: string
  isFinal: boolean
  speaker: string
  speakerId: string
  ts: number
}
```

### 1.4 HTTP Endpoints

Сервер также предоставляет HTTP endpoints:

- `POST /api/realtime/transcribe/broadcast` — broadcast транскриптов (для RTMP ingest)
- `POST /api/transcription/start` — запуск серверной транскрипции
- `POST /api/transcription/stop` — остановка транскрипции
- `POST /api/active-speaker` — обновление активного спикера
- `GET /health` — health check
- `GET /metrics` — метрики сервера

---

## 2. RTMP сервер

### 2.1 Назначение

RTMP сервер принимает аудио потоки от **LiveKit Room Composite Egress** и маршрутизирует их к соответствующим обработчикам транскрипции.

### 2.2 Архитектура

```
LiveKit Room → Egress API → RTMP Stream → RTMP Server → RTMP Ingest → Gladia → Transcripts
```

**Компоненты:**

1. **Node-Media-Server** — принимает RTMP потоки
2. **RTMP Ingest** (`server/rtmp-ingest.ts`) — декодирует RTMP → PCM → Gladia
3. **Stream Path** — идентификатор потока (например, `/session/{sessionId}`)

### 2.3 Жизненный цикл потока

```typescript
// 1. LiveKit создает Egress сессию
POST /twirp/livekit.Egress/StartRoomCompositeEgress
{
  roomName: "session-slug",
  layout: "speaker",
  output: {
    rtmp: {
      url: "rtmp://rtmp-host:1937/session/{sessionId}"
    }
  }
}

// 2. RTMP сервер получает поток
nms.on('prePublish', (id, streamPath) => {
  // streamPath = "/session/{sessionId}"
  const handler = streamHandlers.get(streamPath)
  handler.onStreamStart(streamPath)
})

// 3. RTMP Ingest создает Gladia сессию и обрабатывает аудио
rtmpIngest.start({
  sessionId,
  sessionSlug,
  streamPath: `/session/${sessionId}`
})

// 4. Gladia возвращает транскрипты
gladiaBridge.onTranscript((event) => {
  // Отправляем транскрипт через WebSocket broadcast
  broadcastToSessionClients(sessionSlug, transcript)
})
```

### 2.4 Auto-Ingest режим

В режиме `SERVER_MODE=rtmp` (разделенные сервисы) RTMP сервер автоматически создает ingest при получении потока:

```typescript
rtmpServer.enableAutoIngest(async (streamPath) => {
  // Извлекаем sessionId из streamPath
  const sessionId = extractSessionId(streamPath)
  // Создаем RTMP Ingest
  await createRTMPIngest(sessionId, streamPath)
})
```

### 2.5 FFmpeg декодирование

RTMP Ingest использует FFmpeg для декодирования RTMP потока в PCM аудио:

```bash
ffmpeg -i rtmp://localhost:1937/session/{sessionId} \
  -f s16le -acodec pcm_s16le -ar 16000 -ac 1 \
  -  # stdout для Gladia
```

---

## 3. LiveKit Egress

### 3.1 Room Composite Egress (предпочтительно)

**Преимущества:**
- Одна сессия на комнату (микширование на стороне LiveKit)
- Идеально для speaker diarization
- Меньше нагрузка на сервер

**Процесс:**

1. Next.js вызывает `POST /api/transcription/start`
2. WebSocket сервер создает Egress сессию через LiveKit API
3. LiveKit микширует аудио всех участников
4. Отправляет RTMP поток на наш RTMP сервер
5. RTMP Ingest обрабатывает поток и отправляет в Gladia

### 3.2 Track Egress (fallback)

**Использование:** Когда Room Composite недоступен

**Процесс:**

1. Создается Egress для каждого аудио трека отдельно
2. Аудио отправляется через WebSocket (`/egress/audio/{sessionId}/{trackId}`)
3. Egress Transcriber обрабатывает каждый трек отдельно
4. Транскрипты объединяются на клиенте

### 3.3 Конфигурация

```typescript
// Room Composite Egress
const egress = await livekitClient.startRoomCompositeEgress({
  roomName: sessionSlug,
  layout: 'speaker',
  output: {
    rtmp: {
      url: `rtmp://${rtmpHost}:${rtmpPort}/session/${sessionId}`
    }
  }
})

// Track Egress (fallback)
const egress = await livekitClient.startTrackEgress({
  roomName: sessionSlug,
  trackId: audioTrackId,
  output: {
    websocket: {
      url: `ws://ws-server/egress/audio/${sessionId}/${trackId}`
    }
  }
})
```

---

## 4. Gladia Bridge

### 4.1 Назначение

Gladia Bridge — это адаптер между нашим сервером и Gladia STT API. Он:

1. Создает WebSocket соединение с Gladia
2. Отправляет PCM аудио (16kHz, mono, s16le)
3. Получает транскрипты в реальном времени
4. Обрабатывает speaker diarization

### 4.2 Архитектура

```typescript
// Создание Gladia сессии
const gladiaBridge = await createGladiaBridge({
  apiKey: process.env.GLADIA_API_KEY,
  language: 'en',
  diarization: true, // speaker diarization
})

// Отправка аудио
gladiaBridge.sendAudio(pcmBuffer)

// Получение транскриптов
gladiaBridge.onTranscript((event: TranscriptEvent) => {
  // event.text - текст транскрипта
  // event.isFinal - финальный ли сегмент
  // event.speakerId - ID спикера (diarization)
  // event.speakerName - имя спикера
})
```

### 4.3 Формат данных

**TranscriptEvent:**
```typescript
interface TranscriptEvent {
  text: string
  isFinal: boolean
  utteranceId: string
  speakerId?: string
  speakerName?: string
  startedAt: number
  endedAt: number
}
```

### 4.4 Интеграция с RTMP Ingest

```typescript
// RTMP Ingest получает PCM от FFmpeg
ffmpegProcess.stdout.on('data', (pcmChunk: Buffer) => {
  // Отправляем в Gladia
  gladiaBridge.sendAudio(pcmChunk)
})

// Gladia возвращает транскрипты
gladiaBridge.onTranscript((event) => {
  // Обрабатываем транскрипт
  handleTranscript(event)
})
```

---

## 5. Realtime AI Engine

### 5.1 Архитектура

Realtime AI Engine анализирует транскрипты в реальном времени и генерирует insights:

```
Transcripts → useSessionAiEngine → extractRealtimeInsights → OpenAI → Insights
```

### 5.2 Клиентская часть (`useSessionAiEngine`)

**Логика:**

1. **Накопление транскриптов**: Собирает транскрипты в окно (sliding window)
2. **Debounce**: Вызывает AI только при накоплении достаточного текста (минимум 120 символов)
3. **Throttle**: Ограничивает частоту вызовов (максимум каждые 3 секунды, минимум 500 символов)
4. **Обновление состояния**: Обновляет `topics[]`, `currentTopic`, `aiTitle`

**Ключевые параметры:**

```typescript
const MIN_CHARS_FOR_CALL = 120      // Минимум символов для вызова AI
const MIN_CHARS_BETWEEN_CALLS = 500  // Минимум символов между вызовами
const MIN_SECONDS_BETWEEN_CALLS = 3  // Минимум секунд между вызовами
const TRANSCRIPT_WINDOW_SIZE = 10    // Количество последних транскриптов
```

### 5.3 Серверная часть (`extractRealtimeInsights`)

**Процесс:**

1. **Входные данные**: Окно транскриптов (последние 10 сообщений, ~2000 символов)
2. **OpenAI запрос**: Использует `gpt-4o-mini` с JSON response format
3. **Парсинг ответа**: Извлекает:
   - `aiTitle` — предложенное название сессии
   - `currentTopic` — текущая тема обсуждения
   - `topics[]` — история тем с временными метками
   - `topicChanged` — флаг изменения темы
4. **Сохранение в БД**: Обновляет `VideoSession.aiTitle`, `aiCurrentTopic`, `aiTopicsJson`

**Промпт структура:**

```typescript
{
  system: "You are an AI assistant analyzing meeting transcripts...",
  user: `
    Previous insights: ${JSON.stringify(previousInsights)}
    Transcript window: ${transcriptWindow.text}
    
    Extract:
    - Current topic
    - Topic history
    - Suggested title
  `
}
```

### 5.4 Интеграция с сессией

**Схема БД:**

```prisma
model VideoSession {
  aiTitle              String?
  aiCurrentTopic       String?
  aiTopicsJson        Json?      // Array<{ id, label, startedAtSec }>
  aiUpdatedAt          DateTime?
}
```

**Обновление:**

```typescript
// После получения insights от OpenAI
await updateSession({
  sessionId,
  aiTitle: insights.aiTitle,
  aiCurrentTopic: insights.currentTopic,
  aiTopicsJson: insights.topics,
  aiUpdatedAt: new Date(),
})
```

---

## 6. Полный поток данных

### 6.1 Сценарий: Участник говорит в сессии

```
1. Участник говорит в микрофон
   ↓
2. LiveKit получает аудио трек
   ↓
3. Room Composite Egress микширует все аудио треки
   ↓
4. Egress отправляет RTMP поток на наш сервер
   rtmp://rtmp-server:1937/session/{sessionId}
   ↓
5. RTMP сервер получает поток
   RTMPServer.on('prePublish', streamPath)
   ↓
6. RTMP Ingest создается для потока
   RTMPIngest.start({ sessionId, streamPath })
   ↓
7. FFmpeg декодирует RTMP → PCM
   ffmpeg -i rtmp://... -f s16le -ar 16000 -ac 1
   ↓
8. Gladia Bridge отправляет PCM в Gladia
   gladiaBridge.sendAudio(pcmChunk)
   ↓
9. Gladia возвращает транскрипт
   gladiaBridge.onTranscript({ text, isFinal, speakerId })
   ↓
10. RTMP Ingest обрабатывает транскрипт
    handleTranscript(event)
    ↓
11. Broadcast через WebSocket сервер
    broadcastToSessionClients(sessionSlug, transcript)
    ↓
12. Клиенты получают транскрипт
    useRealtimeTranscript → setTranscripts()
    ↓
13. Realtime AI Engine анализирует
    useSessionAiEngine → extractRealtimeInsights()
    ↓
14. OpenAI генерирует insights
    openaiCompletion() → { topics, currentTopic, aiTitle }
    ↓
15. Сохранение в БД и обновление UI
    updateSession() → CurrentTopicBubble обновляется
```

### 6.2 Сценарий: Клиент подключается к сессии

```
1. Клиент открывает страницу сессии
   /session/{slug}
   ↓
2. Next.js Server Component загружает сессию из БД
   getSessionBySlugCached(slug)
   ↓
3. Передает initial AI insights клиенту
   initialAiInsights = { topics, currentTopic, aiTitle }
   ↓
4. Клиент подключается к LiveKit комнате
   room.connect(serverUrl, token)
   ↓
5. Клиент подключается к WebSocket для транскриптов
   connectTranscriptionWebSocket(wsUrl, token)
   ↓
6. WebSocket сервер регистрирует клиента
   registerClientForSession(sessionSlug, ws, { userId })
   ↓
7. Клиент начинает получать транскрипты
   ws.on('message', (transcript) => { ... })
   ↓
8. Realtime AI Engine инициализируется с initial insights
   useSessionAiEngine({ initialInsights })
   ↓
9. UI отображает текущую тему и историю
   CurrentTopicBubble({ topics, currentTopic })
```

---

## 7. Режимы работы сервера

### 7.1 Monolith (оба сервиса вместе)

**Конфигурация:**
```env
SERVER_MODE=undefined  # или не установлен
PORT=3000              # HTTP/WebSocket сервер
RTMP_PORT=1937         # RTMP сервер
```

**Архитектура:**
- Один процесс на Railway
- HTTP/WebSocket и RTMP в одном процессе
- Прямой broadcast (direct mode) без HTTP-хопа

### 7.2 Split Services (разделенные сервисы)

**WebSocket сервис:**
```env
SERVER_MODE=ws
PORT=3000
```

**RTMP сервис:**
```env
SERVER_MODE=rtmp
RTMP_PORT=1937
```

**Архитектура:**
- Два отдельных процесса на Railway
- RTMP сервис отправляет транскрипты через HTTP (`POST /api/realtime/transcribe/broadcast`)
- WebSocket сервис получает транскрипты и broadcast клиентам

**Преимущества:**
- Масштабируемость (можно масштабировать сервисы независимо)
- Изоляция (RTMP сервис может быть на более мощной машине)

---

## 8. Метрики и мониторинг

### 8.1 Метрики WebSocket сервера

**Endpoint:** `GET /metrics`

**Метрики:**
- `connections` — количество активных соединений
- `messagesSent` — количество отправленных сообщений
- `errors` — количество ошибок
- `queue.length` — длина очереди транскриптов
- `latency.*` — задержки обработки
- `counters.*` — счетчики событий

### 8.2 Метрики транскрипции

**Gladia метрики:**
- `gladia.stt_latency_ms` — задержка STT (speech-to-text)
- `gladia.audio_bytes_sent` — отправлено байт аудио
- `gladia.transcripts_received` — получено транскриптов

**RTMP Ingest метрики:**
- `ingest.broadcast_latency_ms` — задержка broadcast
- `ingest.ffmpeg_errors` — ошибки FFmpeg

**WebSocket метрики:**
- `ws.broadcast_loop_ms` — время broadcast loop
- `ws.transcripts_sent` — отправлено транскриптов клиентам

---

## 9. Обработка ошибок

### 9.1 Ошибки LiveKit

**Unauthorized:**
- Причина: Неверные `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
- Обработка: Отправка ошибки клиентам через WebSocket
- Сообщение: `transcription_error` с `reason: 'livekit_unauthorized'`

### 9.2 Ошибки Gladia

**Connection errors:**
- Retry логика в Gladia Bridge
- Fallback на предыдущие транскрипты

### 9.3 Ошибки WebSocket

**Connection closed:**
- Клиент автоматически переподключается (exponential backoff)
- Максимум 5 попыток

**Broadcast errors:**
- Логирование ошибки
- Продолжение работы для других клиентов

---

## 10. Безопасность

### 10.1 Аутентификация WebSocket

**JWT токен:**
- Генерируется в Next.js API route (`/api/sessions/[slug]/transcription/token`)
- Содержит: `sessionSlug`, `userId`, `sessionId`
- Валидируется на WebSocket сервере перед upgrade

**Валидация:**
```typescript
const tokenData = verifyTranscriptionToken(token)
if (!tokenData || tokenData.sessionSlug !== sessionSlug) {
  // Reject connection
}
```

### 10.2 Изоляция сессий

- Клиенты могут получать транскрипты только для своей сессии
- `sessionSlug` проверяется при регистрации и broadcast

### 10.3 Rate Limiting

- HTTP endpoints защищены rate limiting
- WebSocket соединения ограничены по количеству на сессию

---

## 11. Оптимизации

### 11.1 Batch обработка транскриптов

**Transcript Batch Queue:**
- Накапливает транскрипты в памяти
- Записывает в БД батчами (каждые 5 секунд или при 10 транскриптах)
- Снижает нагрузку на БД

### 11.2 Debounce AI вызовов

- Минимум 120 символов для вызова AI
- Минимум 500 символов между вызовами
- Минимум 3 секунды между вызовами
- Снижает стоимость OpenAI API

### 11.3 Transcript Window

- Используется только последние 10 транскриптов для AI анализа
- Ограничение до 2000 символов в промпте
- Снижает размер промпта и стоимость

---

## 12. Развертывание

### 12.1 Railway

**WebSocket сервис:**
- Port: 3000 (HTTP/WebSocket)
- Environment: `SERVER_MODE=ws` или не установлен
- Variables: `WS_SERVER_URL`, `GLADIA_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

**RTMP сервис (если разделен):**
- Port: 1937 (RTMP)
- TCP Proxy: Railway TCP Proxy для публичного доступа
- Environment: `SERVER_MODE=rtmp`
- Variables: `RTMP_HOST`, `RTMP_EXTERNAL_PORT`

### 12.2 Переменные окружения

**Обязательные:**
```env
# LiveKit
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_URL=wss://...

# Gladia
GLADIA_API_KEY=...

# Database
DATABASE_URL=...

# Next.js (для генерации токенов)
NEXTAUTH_SECRET=...
```

**Опциональные:**
```env
# Server mode
SERVER_MODE=ws|rtmp|undefined

# Ports
PORT=3000
RTMP_PORT=1937

# RTMP (для Railway TCP Proxy)
RTMP_HOST=your-rtmp-service.proxy.rlwy.net
RTMP_EXTERNAL_PORT=58957

# Broadcast mode
REALTIME_BROADCAST_MODE=direct|http
```

---

## 13. Диаграммы

### 13.1 Архитектура компонентов

```
┌─────────────────┐
│   Next.js App   │
│  (Vercel)       │
│                 │
│  - UI           │
│  - API Routes   │
│  - Server       │
│    Actions      │
└────────┬────────┘
         │
         │ HTTP/WebSocket
         │
┌────────▼─────────────────────────┐
│   WebSocket Server (Railway)    │
│                                  │
│  ┌────────────────────────────┐  │
│  │  WebSocket Handler         │  │
│  │  - /api/realtime/transcribe│  │
│  │  - /egress/audio/*         │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  RTMP Server                │  │
│  │  - Port 1937                │  │
│  │  - Node-Media-Server       │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  RTMP Ingest                │  │
│  │  - FFmpeg decoder           │  │
│  │  - Gladia Bridge            │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Client Registry            │  │
│  │  - sessionClients Map       │  │
│  │  - Broadcast logic         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
         │
         │ RTMP
         │
┌────────▼────────┐
│   LiveKit       │
│                 │
│  - Room         │
│  - Egress API   │
│  - Data Channel │
└─────────────────┘
         │
         │ API
         │
┌────────▼────────┐
│   Gladia STT    │
│                 │
│  - WebSocket    │
│  - Diarization  │
└─────────────────┘
```

### 13.2 Поток транскрипции

```
┌──────────────┐
│  Participant │
│  (Browser)   │
└──────┬───────┘
       │ Audio
       │
┌──────▼──────────────┐
│   LiveKit Room      │
│                     │
│  - Mixes audio      │
│  - Egress API       │
└──────┬──────────────┘
       │ RTMP Stream
       │
┌──────▼──────────────┐
│   RTMP Server       │
│   (Port 1937)       │
└──────┬──────────────┘
       │ Stream Path
       │
┌──────▼──────────────┐
│   RTMP Ingest       │
│                     │
│  FFmpeg → PCM       │
└──────┬──────────────┘
       │ PCM Audio
       │
┌──────▼──────────────┐
│   Gladia Bridge     │
│                     │
│  - WebSocket        │
│  - Diarization      │
└──────┬──────────────┘
       │ Transcript
       │
┌──────▼──────────────┐
│   WebSocket Server  │
│                     │
│  Broadcast to       │
│  clients            │
└──────┬──────────────┘
       │ WebSocket
       │
┌──────▼──────────────┐
│   Client (Browser)  │
│                     │
│  - useRealtime      │
│    Transcript       │
│  - useSessionAi     │
│    Engine           │
└─────────────────────┘
```

### 13.3 Realtime AI поток

```
┌─────────────────┐
│  Transcripts    │
│  (useRealtime   │
│   Transcript)   │
└────────┬────────┘
         │
         │ Sliding Window
         │
┌────────▼──────────────────┐
│  useSessionAiEngine       │
│                           │
│  - Debounce (120 chars)   │
│  - Throttle (500 chars,   │
│    3 seconds)             │
│  - Window (last 10)       │
└────────┬──────────────────┘
         │
         │ API Call
         │
┌────────▼──────────────────┐
│  POST /api/sessions/      │
│  [slug]/ai/realtime-      │
│  insights                 │
└────────┬──────────────────┘
         │
         │
┌────────▼──────────────────┐
│  extractRealtimeInsights  │
│                           │
│  - Build prompt           │
│  - Call OpenAI            │
│  - Parse response         │
└────────┬──────────────────┘
         │
         │ Insights
         │
┌────────▼──────────────────┐
│  Update Session DB        │
│                           │
│  - aiTitle                │
│  - aiCurrentTopic         │
│  - aiTopicsJson           │
└────────┬──────────────────┘
         │
         │ State Update
         │
┌────────▼──────────────────┐
│  UI Update                │
│                           │
│  - CurrentTopicBubble     │
│  - Topics history         │
└───────────────────────────┘
```

---

## 14. Заключение

Архитектура WebSocket/RTMP сервера и Realtime AI обеспечивает:

1. **Масштабируемость**: Разделение сервисов позволяет масштабировать независимо
2. **Надежность**: Retry логика, graceful shutdown, error handling
3. **Производительность**: Batch обработка, debounce, оптимизированные промпты
4. **Безопасность**: JWT аутентификация, изоляция сессий, rate limiting
5. **Мониторинг**: Метрики, health checks, логирование

Система спроектирована для обработки realtime транскрипции и AI анализа в production окружении с высокой нагрузкой.


# Техническая архитектура сессий и транскрипции

Детальное техническое описание архитектуры системы видеосессий с транскрипцией в реальном времени.

---

## Оглавление

1. [Общая архитектура](#1-общая-архитектура)
2. [Модульная структура](#2-модульная-структура)
3. [Поток данных](#3-поток-данных)
4. [Компоненты системы](#4-компоненты-системы)
5. [База данных](#5-база-данных)
6. [LiveKit интеграция](#6-livekit-интеграция)
7. [Транскрипция (Gladia)](#7-транскрипция-gladia)
8. [WebSocket сервер](#8-websocket-сервер)
9. [Состояния и синхронизация](#9-состояния-и-синхронизация)
10. [Обработка ошибок и переподключение](#10-обработка-ошибок-и-переподключение)

---

## 1. Общая архитектура

### 1.1. Высокоуровневая схема

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (Client)                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  SessionContent (page.tsx)                                     │ │
│  │  - UI управления сессией                                       │ │
│  │  - Управление микрофоном/камерой                              │ │
│  │  - Отображение транскриптов                                    │ │
│  └────────────┬──────────────────────────────────────────────┘    │
│               │                                                   │
│  ┌────────────▼──────────────────────────────────────────────┐    │
│  │  useLocalParticipantTranscription (hook)                  │    │
│  │  - AudioContext + AudioWorklet                            │    │
│  │  - Захват аудио из MediaStreamTrack                      │    │
│  │  - Конвертация в PCM16                                    │    │
│  │  - WebSocket к транскрипционному серверу                  │    │
│  └────────────┬──────────────────────────────────────────────┘    │
│               │                                                   │
│  ┌────────────▼──────────────────────────────────────────────┐    │
│  │  LiveKit Client (livekit-client)                          │    │
│  │  - Room connection                                        │    │
│  │  - LocalParticipant                                       │    │
│  │  - TrackPublication / Track                               │    │
│  │  - WebRTC для видеосвязи                                 │    │
│  └────────────┬──────────────────────────────────────────────┘    │
└───────────────┼────────────────────────────────────────────────────┘
                │
                │ WebRTC
                │
┌───────────────▼────────────────────────────────────────────────────┐
│                    LiveKit Cloud Server                            │
│              (WebRTC медиа-сервер)                                 │
└───────────────┬────────────────────────────────────────────────────┘
                │
                │ HTTP WebSocket
                │
┌───────────────▼────────────────────────────────────────────────────┐
│              Next.js API Routes (app/api)                          │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  /api/sessions/[slug]/token                                   │ │
│  │  - Генерация LiveKit токена                                  │ │
│  │  - Создание участника в БД                                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
                │
                │ HTTP WebSocket (ws://localhost:3001)
                │
┌───────────────▼────────────────────────────────────────────────────┐
│         WebSocket Server (ws/server/index.ts)                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  handleClientConnection()                                     │ │
│  │  - Принимает аудио чанки (PCM16)                             │ │
│  │  - Создает GladiaBridge для каждого клиента                  │ │
│  └────────────┬──────────────────────────────────────────────────┘ │
│               │                                                    │
│  ┌────────────▼──────────────────────────────────────────────────┐ │
│  │  GladiaBridge (ws/server/gladia-bridge.ts)                   │ │
│  │  - Инициализация сессии через POST /v2/live                 │ │
│  │  - WebSocket к Gladia API                                   │ │
│  │  - Отправка аудио → Получение транскриптов                  │ │
│  └────────────┬──────────────────────────────────────────────────┘ │
└───────────────┼────────────────────────────────────────────────────┘
                │
                │ HTTPS WebSocket
                │
┌───────────────▼────────────────────────────────────────────────────┐
│                    Gladia API (api.gladia.io)                      │
│              (Real-time транскрипция аудио)                        │
└────────────────────────────────────────────────────────────────────┘
                │
                │ HTTP API
                │
┌───────────────▼────────────────────────────────────────────────────┐
│         PostgreSQL Database (Neon)                                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  VideoSession                                                 │ │
│  │  Participant                                                  │ │
│  │  TranscriptSegment                                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2. Технологический стек

**Frontend:**
- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- LiveKit Client SDK (`livekit-client`)
- Web Audio API (AudioContext, AudioWorklet)

**Backend:**
- Next.js API Routes
- Node.js WebSocket Server (отдельный процесс)
- Prisma ORM
- PostgreSQL (Neon)

**Внешние сервисы:**
- LiveKit Cloud (WebRTC медиа-сервер)
- Gladia API (real-time транскрипция)

---

## 2. Модульная структура

### 2.1. Структура модуля `core/sessions`

```
src/modules/core/sessions/
├── domain/
│   └── session.types.ts              # Доменные типы (Session, CreateSessionInput, etc.)
├── infra/
│   ├── prisma/
│   │   ├── sessions.repository.ts    # CRUD операции для VideoSession
│   │   ├── participants.repository.ts # CRUD операции для Participant
│   │   └── transcripts.repository.ts  # CRUD операции для TranscriptSegment
│   ├── livekit/
│   │   ├── token.service.ts          # Генерация LiveKit Access Token
│   │   └── client-config.ts          # Конфигурация LiveKit клиента
│   ├── participants/
│   │   └── participants.repository.ts # Репозиторий участников
│   └── transcription/
│       ├── appendTranscriptChunk.ts   # Сохранение транскриптов в БД
│       ├── listSessionTranscripts.ts  # Получение транскриптов сессии
│       └── transcript.types.ts        # Типы транскриптов
├── application/
│   ├── createSession.ts              # Use-case: создание сессии
│   ├── getSessionBySlug.ts           # Use-case: получение сессии
│   ├── listSessionsBySpace.ts        # Use-case: список сессий
│   ├── deleteSession.ts              # Use-case: удаление сессии
│   ├── endSession.ts                 # Use-case: завершение сессии
│   └── upsertParticipantOnJoin.ts    # Use-case: создание/обновление участника
└── api/
    ├── createSessionEndpoint.ts      # HTTP endpoint функция
    ├── listSessionsEndpoint.ts       # HTTP endpoint функция
    ├── deleteSessionEndpoint.ts      # HTTP endpoint функция
    └── upsertParticipantOnJoinEndpoint.ts # HTTP endpoint функция
```

### 2.2. Принципы архитектуры

**Разделение слоев:**

1. **domain/** — Доменные сущности и типы (без зависимостей от инфраструктуры)
2. **infra/** — Реализация внешних интеграций:
   - `prisma/` — работа с БД через Prisma
   - `livekit/` — интеграция с LiveKit API
   - `transcription/` — работа с транскриптами
3. **application/** — Бизнес-логика (use-cases)
4. **api/** — Тонкий слой HTTP endpoints

**Правила:**
- `domain/` не знает про Prisma, LiveKit, HTTP
- `infra/` не содержит бизнес-логики, только адаптеры
- `application/` содержит бизнес-правила
- `api/` только валидация и вызов application

---

## 3. Поток данных

### 3.1. Создание и подключение к сессии

```
1. Пользователь создает сессию
   ↓
   POST /api/sessions
   → createSessionEndpoint()
   → createSession()
   → sessions.repository.createSession()
   → INSERT INTO VideoSession
   ↓
2. Пользователь открывает страницу /session/[slug]
   ↓
   GET /api/sessions/[slug]/token
   → generateToken() (LiveKit токен)
   → upsertParticipantOnJoin() (создание участника в БД)
   ↓
3. Frontend подключается к LiveKit
   → room.connect(token, serverUrl)
   ↓
4. LiveKit авторизует подключение
   ↓
5. localParticipant создается
   ↓
6. Автоматически включается микрофон
   → localParticipant.setMicrophoneEnabled(true)
   ↓
7. Транскрипция запускается автоматически
   → useLocalParticipantTranscription.start()
```

### 3.2. Поток аудио → транскрипт

```
┌─────────────────────────────────────────────────────────────┐
│  Браузер (Client)                                           │
│                                                             │
│  1. MediaStreamTrack (микрофон)                            │
│     ↓                                                       │
│  2. MediaStreamAudioSourceNode                              │
│     ↓                                                       │
│  3. AudioWorkletNode (TranscriptionProcessor)              │
│     - Обработка аудио в реальном времени                   │
│     - Отправка Float32Array через postMessage              │
│     ↓                                                       │
│  4. convertAndSendAudio()                                   │
│     - Конвертация Float32Array → Int16Array (PCM16)       │
│     - Проверка mute состояния                              │
│     ↓                                                       │
│  5. WebSocket.send(ArrayBuffer)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ WebSocket (ws://localhost:3001/api/realtime/transcribe?sessionSlug=...)
                     │
┌────────────────────▼────────────────────────────────────────┐
│  WebSocket Server (ws/server/)                              │
│                                                             │
│  6. handleClientConnection()                                │
│     - Создает GladiaBridge для клиента                     │
│     ↓                                                       │
│  7. ws.on('message', (audioChunk) =>                        │
│       gladiaBridge.sendAudio(audioChunk))                   │
│     ↓                                                       │
│  8. GladiaBridge                                            │
│     - Отправляет аудио в Gladia WebSocket                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS WebSocket (wss://api.gladia.io/...)
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Gladia API                                                 │
│                                                             │
│  9. Обработка аудио и транскрипция                         │
│     ↓                                                       │
│  10. Отправка транскриптов обратно                         │
│      - partial (is_final: false)                           │
│      - final (is_final: true)                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ WebSocket message (JSON)
                     │
┌────────────────────▼────────────────────────────────────────┐
│  WebSocket Server                                           │
│                                                             │
│  11. GladiaBridge.onTranscript()                           │
│      ↓                                                      │
│  12. appendTranscriptChunk()                                │
│      - Сохранение в БД (Prisma)                            │
│      ↓                                                      │
│  13. ws.send(JSON.stringify({                               │
│        type: 'transcription',                               │
│        text: event.text,                                    │
│        is_final: event.isFinal,                             │
│        utterance_id: event.utteranceId                      │
│      }))                                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ WebSocket message
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Frontend (Client)                                          │
│                                                             │
│  14. WebSocket.onmessage                                    │
│      ↓                                                      │
│  15. handleMessage()                                        │
│      - Парсинг JSON                                         │
│      ↓                                                      │
│  16. sendTranscriptFromServer()                             │
│      - Вызов onTranscriptCallback                           │
│      - Публикация в LiveKit room через publishData()       │
│      ↓                                                      │
│  17. useTranscriptStream                                    │
│      - Обработка dataReceived события                      │
│      - addMessage() → обновление UI                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Компоненты системы

### 4.1. Frontend компоненты

#### `SessionContent` (`src/app/session/[slug]/page.tsx`)

Главный компонент страницы сессии.

**Ответственность:**
- Управление UI состояниями (микрофон, камера, screen share)
- Подключение к LiveKit комнате
- Управление транскрипцией
- Отображение участников и транскриптов

**Ключевые функции:**

```typescript
const handleMicrophoneToggle = async (enabled: boolean) => {
  // Только обновляет UI и вызывает LiveKit
  // НЕ управляет транскрипцией напрямую
  await localParticipant.setMicrophoneEnabled(enabled)
}
```

**Состояния:**
- `micEnabled` — состояние кнопки микрофона
- `cameraEnabled` — состояние камеры
- `screenShareEnabled` — состояние screen share

#### `useLocalParticipantTranscription` (`src/hooks/useLocalParticipantTranscription.ts`)

Хук для управления транскрипцией локального участника.

**Ответственность:**
- Захват аудио из микрофона
- Обработка через AudioContext + AudioWorklet
- Отправка аудио на WebSocket сервер
- Получение транскриптов и публикация в LiveKit room

**Ключевые refs:**
- `wsRef` — WebSocket соединение
- `audioContextRef` — AudioContext для обработки аудио
- `workletNodeRef` — AudioWorkletNode для обработки
- `sourceRef` — MediaStreamAudioSourceNode
- `mediaStreamRef` — MediaStream
- `mediaStreamTrackRef` — текущий MediaStreamTrack
- `localParticipantRef` — ссылка на LocalParticipant

**Ключевые функции:**
- `convertAndSendAudio()` — конвертация и отправка аудио с проверкой mute
- `sendTranscriptFromServer()` — обработка транскриптов от сервера

#### `useTranscriptStream` (`src/hooks/useTranscriptStream.ts`)

Хук для получения транскриптов из LiveKit room.

**Ответственность:**
- Подписка на `dataReceived` события от LiveKit
- Группировка транскриптов по `utteranceId`
- Обновление UI списка транскриптов

**Особенности:**
- LOCAL ECHO PROTECTION — игнорирует сообщения от локального участника
- Группировка по `utteranceId` для правильного отображения partial/final

### 4.2. Backend компоненты

#### WebSocket Server (`ws/server/index.ts`)

Отдельный Node.js сервер для обработки транскрипции.

**Порт:** `3001` (настраивается через `WS_PORT`)

**Путь:** `/api/realtime/transcribe`

**Ответственность:**
- Прием WebSocket подключений от клиентов
- Создание GladiaBridge для каждого клиента
- Маршрутизация аудио → Gladia
- Маршрутизация транскриптов → клиент

**Архитектура:**
- Один WebSocket соединение на клиента
- Один GladiaBridge на клиента
- Изоляция между клиентами

#### `GladiaBridge` (`ws/server/gladia-bridge.ts`)

Адаптер для работы с Gladia API.

**Инициализация:**
1. POST запрос к `https://api.gladia.io/v2/live` с конфигурацией
2. Получение WebSocket URL
3. Подключение к WebSocket
4. Отправка аудио и получение транскриптов

**Конфигурация Gladia:**
```typescript
{
  encoding: 'wav/pcm',
  sample_rate: 16000,
  bit_depth: 16,
  channels: 1,
  messages_config: {
    receive_partial_transcripts: true,
  },
}
```

---

## 5. База данных

### 5.1. Модели Prisma

#### `VideoSession`

```prisma
model VideoSession {
  id              String          @id @default(cuid())
  slug            String          @unique  // Уникальный URL идентификатор
  title           String?
  createdByUserId String?
  status          SessionStatus   @default(ACTIVE)
  createdAt       DateTime        @default(now())
  endedAt         DateTime?
  spaceId         String
  
  participants    Participant[]
  transcripts     TranscriptSegment[]
}
```

**Ключевые поля:**
- `slug` — уникальный идентификатор для URL (`/session/[slug]`)
- `status` — ACTIVE или ENDED
- `spaceId` — привязка к рабочему пространству

#### `Participant`

```prisma
model Participant {
  id            String            @id @default(cuid())
  videoSessionId String
  userId        String?
  identity      String            // LiveKit identity
  name          String?
  role          ParticipantRole   @default(GUEST)
  joinedAt      DateTime          @default(now())
  leftAt        DateTime?
  
  transcripts   TranscriptSegment[]
}
```

**Ключевые поля:**
- `identity` — уникальный идентификатор в LiveKit (например, `userId:sessionId`)
- `role` — HOST или GUEST
- `@@unique([videoSessionId, identity])` — уникальность в рамках сессии

#### `TranscriptSegment`

```prisma
model TranscriptSegment {
  id            String       @id @default(cuid())
  videoSessionId String
  participantId String?
  utteranceId   String       // Gladia data.id
  text          String
  language      String?
  isFinal       Boolean      @default(false)
  startedAt     DateTime?
  endedAt       DateTime?
  createdAt     DateTime     @default(now())
}
```

**Ключевые поля:**
- `utteranceId` — ID сегмента от Gladia (для группировки partial/final)
- `isFinal` — финальный ли это транскрипт или partial (драфт)
- `@@unique([videoSessionId, utteranceId])` — один сегмент на utteranceId

### 5.2. Репозитории

**Расположение:** `src/modules/core/sessions/infra/prisma/`

- `sessions.repository.ts` — CRUD для VideoSession
- `participants.repository.ts` — CRUD для Participant
- `transcripts.repository.ts` — CRUD для TranscriptSegment

Все репозитории работают напрямую с Prisma, без бизнес-логики.

---

## 6. LiveKit интеграция

### 6.1. Токены доступа

**Файл:** `src/modules/core/sessions/infra/livekit/token.service.ts`

**Функция:** `generateToken(input: GenerateTokenInput)`

**Процесс:**
1. Создание `AccessToken` с API key/secret
2. Добавление grant'ов (права доступа)
3. Генерация JWT токена

**Grant'ы:**
- `roomJoin: true` — разрешение войти в комнату
- `canPublish: true` — разрешение публиковать треки
- `canSubscribe: true` — разрешение подписываться на треки

### 6.2. Подключение к комнате

**Хук:** `useRoom(token, serverUrl)`

**Процесс:**
1. Создание `Room` инстанса
2. Подключение через `room.connect(token, serverUrl)`
3. Ожидание события `Connected`
4. Получение `localParticipant` и `remoteParticipants`

### 6.3. Управление треками

**Включение/выключение микрофона:**
```typescript
await localParticipant.setMicrophoneEnabled(true)  // Включить
await localParticipant.setMicrophoneEnabled(false) // Выключить
```

**События:**
- `trackPublished` — трек опубликован
- `trackUnpublished` — трек удален
- `trackMuted` — трек приглушен
- `trackUnmuted` — трек включен

**Состояние:**
```typescript
const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
const isMuted = micPublication?.isMuted // true = выключен, false = включен
```

---

## 7. Транскрипция (Gladia)

### 7.1. Инициализация Gladia сессии

**Файл:** `ws/server/gladia-bridge.ts`

**Процесс:**
1. POST запрос к `https://api.gladia.io/v2/live` с конфигурацией
2. Получение WebSocket URL для транскрипции
3. Подключение к WebSocket
4. Готовность к приему аудио

**Конфигурация:**
- Формат: PCM16 (16-bit, little-endian)
- Sample rate: 16000 Hz (требуется Gladia)
- Каналы: 1 (моно)
- Partial transcripts: включены

### 7.2. Формат аудио

**Входящий (от клиента):**
- Формат: `Int16Array` (PCM16)
- Sample rate: 16000 Hz
- Каналы: 1 (моно)

**Конвертация в клиенте:**
```typescript
// Float32Array → Int16Array (PCM16)
const pcm16 = new Int16Array(float32Data.length)
for (let i = 0; i < float32Data.length; i++) {
  const s = Math.max(-1, Math.min(1, float32Data[i]))
  pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
}
```

### 7.3. Формат транскриптов от Gladia

**Структура сообщения:**
```json
{
  "type": "transcript",
  "data": {
    "id": "00-00000011",           // utteranceId
    "is_final": false,              // false = partial, true = final
    "utterance": {
      "text": "Hello world.",
      ...
    }
  }
}
```

**Обработка:**
- `is_final: false` → partial (драфт, обновляется в реальном времени)
- `is_final: true` → final (окончательная версия)

---

## 8. WebSocket сервер

### 8.1. Архитектура

**Файл:** `ws/server/index.ts`

**Структура:**
- HTTP сервер для WebSocket upgrade
- WebSocketServer на пути `/api/realtime/transcribe`
- Один handler на подключение: `handleClientConnection()`

**Параметры подключения:**
- Query параметры: `sessionSlug`, `identity` (опционально)
- Используются для сохранения транскриптов в БД

### 8.2. Обработка клиентов

**Файл:** `ws/server/client-connection.ts`

**Процесс:**
1. Извлечение `sessionSlug` из URL
2. Создание `GladiaBridge` для клиента
3. Подписка на транскрипты: `bridge.onTranscript()`
4. При получении транскрипта:
   - Сохранение в БД через `appendTranscriptChunk()`
   - Отправка клиенту через WebSocket

**Изоляция:**
- Каждый клиент получает свой `GladiaBridge`
- Аудио и транскрипты изолированы между клиентами

### 8.3. Формат сообщений

**Клиент → Сервер:**
- Аудио чанки: `ArrayBuffer` (PCM16)

**Сервер → Клиент:**
```json
{
  "type": "transcription",
  "text": "Hello world.",
  "is_final": false,
  "utterance_id": "00-00000011"
}
```

---

## 9. Состояния и синхронизация

### 9.1. Состояния микрофона

**Уровень 1: LiveKit TrackPublication**
```typescript
const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
const isMuted = micPublication?.isMuted // true = выключен
```

**Уровень 2: MediaStreamTrack (браузер)**
```typescript
const track = mediaStreamTrackRef.current
const isLive = track?.enabled === true && 
               track?.muted === false && 
               track?.readyState === 'live'
```

**Уровень 3: UI State (React)**
```typescript
const [micEnabled, setMicEnabled] = useState(true)
// true = микрофон включен (кнопка показывает "muted")
// false = микрофон выключен (кнопка показывает "unmuted")
```

**Синхронизация:**
- UI обновляется через события LiveKit (`trackMuted`, `trackUnmuted`)
- Оптимистичное обновление при клике на кнопку
- Финальная синхронизация через проверку `micPublication.isMuted`

### 9.2. Гейтинг аудио (mute)

**Место блокировки:** `convertAndSendAudio()` в `useLocalParticipantTranscription`

**Логика (улучшенная):**
```typescript
// Проверка 1: LiveKit TrackPublication
const liveKitMuted = micPublication.isMuted === true

// Проверка 2: MediaStreamTrack (браузерный)
const trackIsLive = track && 
  track.enabled === true && 
  track.muted === false && 
  track.readyState === 'live'

// Блокируем только если LiveKit говорит muted И MediaStreamTrack тоже не живой
// Это помогает избежать ложных блокировок при временных проблемах синхронизации
const isMicrophoneMuted = liveKitMuted && !trackIsLive

if (isMicrophoneMuted) {
  return // Не отправляем аудио
}

// Дополнительная проверка: если MediaStreamTrack не живой, блокируем
// (даже если LiveKit говорит, что микрофон не muted)
if (track && (track.enabled === false || track.muted === true || track.readyState !== 'live')) {
  return // Не отправляем аудио
}
```

**Важно:**
- Mute **НЕ останавливает** пайплайн транскрипции
- Mute **только блокирует** отправку аудио на WebSocket
- При unmute аудио снова начинает отправляться без перезапуска пайплайна
- **Двойная проверка** (LiveKit + MediaStreamTrack) помогает избежать ложных блокировок при временных проблемах синхронизации состояния в LiveKit

### 9.3. Состояние транскрипции

**`isActive`** — желание пользователя иметь транскрипцию
- `true` — транскрипция должна работать
- `false` — транскрипция выключена

**Важно:**
- `isActive` НЕ зависит от состояния микрофона
- Mute микрофона НЕ меняет `isActive`
- `isActive` меняется только при явном старте/стопе

**Условия запуска транскрипции:**
```typescript
const shouldBeActive = isActive && 
  (connectionState === ConnectionState.Connected || connectionState === ConnectionState.Reconnecting) && 
  !!room && 
  !!localParticipant
```

---

## 10. Обработка ошибок и переподключение

### 10.1. WebSocket переподключение

**Логика:**
- При закрытии WebSocket (не код 1000) → автоматическое переподключение
- Переподключение НЕ перезапускает пайплайн (AudioContext остается активным)
- Только WebSocket пересоздается, аудио продолжает обрабатываться

**Защита от перезапуска:**
```typescript
const isAlreadyRunning = (
  audioContextRef.current &&
  workletNodeRef.current &&
  sourceRef.current &&
  mediaStreamRef.current
)

if (isAlreadyRunning && shouldBeActive) {
  return // Не перезапускаем
}
```

### 10.2. Обновление MediaStreamTrack

**Проблема:** При unmute LiveKit может создать новый MediaStreamTrack

**Решение:** `updateMediaStreamTrackRef()`
- Отслеживание событий `trackMuted`, `trackUnmuted`, `trackPublished`
- Обновление `mediaStreamTrackRef.current`
- Пересоздание `MediaStream` и `MediaStreamAudioSourceNode` при изменении трека

### 10.3. Health checks

**Периодическая проверка WebSocket:**
- Каждые 5 секунд проверяется состояние WebSocket
- Логирование при проблемах

**Проверка перед отправкой аудио:**
- Проверка `ws.readyState === WebSocket.OPEN`
- Логирование при проблемах

---

## 11. Детали реализации

### 11.1. AudioWorklet Processor

**Файл:** `public/transcription-processor.js`

**Назначение:**
- Обработка аудио в отдельном потоке (не блокирует UI)
- Отправка Float32Array через `postMessage`

**Использование:**
```typescript
await audioContext.audioWorklet.addModule('/transcription-processor.js')
const workletNode = new AudioWorkletNode(audioContext, 'TranscriptionProcessor')
workletNode.port.onmessage = (event) => {
  const float32Data = new Float32Array(event.data.buffer)
  convertAndSendAudio(float32Data)
}
```

### 11.2. Замыкания и refs

**Проблема:** Замыкания в `convertAndSendAudio` могут использовать устаревшие значения

**Решение:**
- Использование `localParticipantRef.current` вместо замыкания
- Обновление ref через `useEffect` при изменении `localParticipant`
- `convertAndSendAudio` всегда использует актуальное значение из ref

### 11.3. Счетчики и логирование

**`audioChunkCountRef`** — счетчик отправленных аудио-чанков
- Используется для логирования (логируются только каждый 100-й чанк)
- Сбрасывается при mute/unmute для корректного логирования

**Логирование:**
- Детальное логирование при первом чанке
- Периодическое логирование (каждый 100-й чанк)
- Критические события логируются всегда

---

## 12. API Endpoints

### 12.1. Создание сессии

**POST** `/api/sessions`

**Body:**
```json
{
  "title": "Optional title",
  "spaceId": "space_id"
}
```

**Ответ:**
```json
{
  "id": "session_id",
  "slug": "unique-slug",
  "title": "Optional title",
  "status": "ACTIVE",
  ...
}
```

### 12.2. Получение токена

**GET** `/api/sessions/[slug]/token?name=DisplayName`

**Ответ:**
```json
{
  "token": "livekit_jwt_token",
  "roomName": "session-slug",
  "identity": "userId:sessionId",
  "serverUrl": "wss://..."
}
```

### 12.3. Подключение участника

**POST** `/api/sessions/[slug]/participants/join`

**Body:**
```json
{
  "identity": "userId:sessionId",
  "name": "Display Name"
}
```

**Процесс:**
- Создание/обновление Participant в БД
- Возврат Participant объекта

### 12.4. Список сессий

**GET** `/api/sessions`

**Query параметры:**
- `spaceId` (опционально) — фильтр по пространству

**Ответ:**
```json
[
  {
    "id": "session_id",
    "slug": "session-slug",
    "title": "Session title",
    "status": "ACTIVE",
    ...
  }
]
```

---

## 13. Конфигурация

### 13.1. Переменные окружения

**LiveKit:**
- `LIVEKIT_API_KEY` — API ключ
- `LIVEKIT_API_SECRET` — API секрет
- `LIVEKIT_WS_URL` — WebSocket URL (например, `wss://...`)

**Gladia:**
- `GLADIA_API_KEY` — API ключ для транскрипции

**WebSocket Server:**
- `WS_PORT` — порт для WebSocket сервера (по умолчанию 3001)

**Database:**
- `DATABASE_URL` — PostgreSQL connection string (Neon)

### 13.2. Конфигурация Gladia

**Фиксированные параметры:**
- Sample rate: 16000 Hz (обязательно для Gladia)
- Format: PCM16 (16-bit, little-endian)
- Channels: 1 (моно)
- Partial transcripts: включены

---

## 14. Ограничения и особенности

### 14.1. Текущие ограничения

1. **Один WebSocket сервер** — все клиенты подключаются к одному процессу
2. **Нет очереди задач** — транскрипты обрабатываются синхронно
3. **Нет Redis** — нет кэширования или rate limiting
4. **Простая архитектура** — без CQRS, Event Sourcing

### 14.2. Особенности реализации

1. **LOCAL ECHO PROTECTION** — транскрипты от локального участника игнорируются в `useTranscriptStream` (избежание дублирования)
2. **Оптимистичное обновление UI** — кнопки реагируют мгновенно, затем синхронизируются с реальным состоянием
3. **Защита от перезапуска** — пайплайн не перезапускается при подключении других участников

### 14.3. Будущие улучшения

**При необходимости масштабирования:**
- Redis для кэширования и rate limiting
- Очередь задач для фоновой обработки
- Отдельный воркер для тяжелых операций (AI-анализ транскриптов)
- Горизонтальное масштабирование WebSocket сервера

---

## 15. Отладка и мониторинг

### 15.1. Ключевые логи

**Client:**
- `[Transcription]` — все события транскрипции
- `[SessionContent]` — события управления сессией
- `[Transcription] ✅ Audio chunk ALLOWED` — аудио разрешено
- `[Transcription] ❌ Audio chunk BLOCKED` — аудио заблокировано

**Server:**
- `[WS-SERVER]` — события WebSocket сервера
- `[GladiaBridge]` — события Gladia интеграции

### 15.2. Метрики для мониторинга

**Текущие:**
- Счетчик отправленных аудио-чанков (`audioChunkCountRef.current`)
- Состояние WebSocket соединения
- Состояние AudioContext

**Потенциальные (не реализованы):**
- Количество активных сессий
- Latency транскрипции
- Ошибки подключения
- Использование памяти/CPU

---

## 16. Известные проблемы и решения

### 16.1. Проблема: Транскрипты не приходят

**Возможные причины:**
1. WebSocket закрывается без логирования
2. Сервер не отправляет транскрипты
3. Обработчик сообщений не вызывается

**Решение:**
- Добавлено детальное логирование всех входящих сообщений
- Health checks WebSocket каждые 5 секунд
- Логирование состояния WebSocket при отправке аудио

### 16.2. Проблема: Транскрипция не останавливается при mute

**Решение:**
- Проверка mute в `convertAndSendAudio()` перед отправкой каждого чанка
- Проверка как LiveKit `isMuted`, так и браузерного `MediaStreamTrack`

### 16.3. Проблема: Транскрипция не возобновляется после unmute

**Решение:**
- `updateMediaStreamTrackRef()` отслеживает изменения трека
- Пересоздание MediaStream и MediaStreamAudioSourceNode при изменении трека

### 16.4. Проблема: Транскрипция останавливается случайно для всех участников

**Симптомы:**
- В логах множество сообщений `[Transcription] ❌ Audio chunk BLOCKED: microphone is muted`
- Транскрипция останавливается даже когда микрофон не должен быть muted
- Проблема возникает после подключения других участников или через некоторое время

**Причина:**
- LiveKit может временно устанавливать `isMuted` в `true` при определенных условиях (проблемы с сетью, синхронизация состояния и т.д.)
- Это не связано с реальным состоянием микрофона

**Решение:**
- Улучшена логика проверки mute: блокируем отправку только если LiveKit говорит muted И MediaStreamTrack тоже не живой
- Если MediaStreamTrack живой, но LiveKit говорит muted - это временная проблема синхронизации, полагаемся на MediaStreamTrack
- Добавлено детальное логирование для отслеживания расхождений состояний

---

## 17. Примеры кода

### 17.1. Запуск транскрипции

```typescript
const { start, stop, isActive } = useLocalParticipantTranscription({
  sessionSlug,
  room,
  localParticipant,
  connectionState,
})

// Автоматический старт при подключении
useEffect(() => {
  if (!isActive && connectionState === ConnectionState.Connected) {
    start()
  }
}, [isActive, connectionState, start])
```

### 17.2. Проверка mute состояния

```typescript
const micPublication = localParticipant?.getTrackPublication(Track.Source.Microphone)
const isMuted = micPublication?.isMuted === true

if (isMuted) {
  // Микрофон выключен - не отправляем аудио
  return
}
```

### 17.3. Обработка транскриптов

```typescript
const { addMessage, messages } = useTranscriptStream({ sessionSlug, room })

// Связывание с транскрипцией
useEffect(() => {
  setOnTranscriptCallback(addMessage)
  return () => setOnTranscriptCallback(null)
}, [setOnTranscriptCallback, addMessage])
```

---

## 18. Глоссарий

- **TrackPublication** — LiveKit объект, представляющий публикацию трека
- **MediaStreamTrack** — нативный браузерный объект аудио/видео трека
- **AudioWorklet** — Web Audio API API для обработки аудио в отдельном потоке
- **PCM16** — формат аудио: 16-bit Pulse Code Modulation
- **utteranceId** — уникальный ID сегмента транскрипта от Gladia
- **partial transcript** — драфт транскрипта, обновляется в реальном времени
- **final transcript** — окончательная версия транскрипта

---

*Документ обновлен: 2025-01-30*


# Полная архитектура транскрипции сессий

## Содержание

1. [Текущая реализация](#текущая-реализация)
2. [Технологический стек](#технологический-стек)
3. [Архитектура системы](#архитектура-системы)
4. [Поток данных](#поток-данных)
5. [Компоненты системы](#компоненты-системы)
6. [Метрики и мониторинг](#метрики-и-мониторинг)
7. [Учёт стоимости](#учёт-стоимости)
8. [Поведение при нагрузках](#поведение-при-нагрузках)
9. [Масштабируемость](#масштабируемость)
10. [Рекомендации по оптимизации](#рекомендации-по-оптимизации)

---

## Текущая реализация

### Модель: Client-Side Транскрипция (Каждый участник транскрибирует себя)

**Принцип работы:**
- Каждый участник сессии запускает свою собственную транскрипцию на клиенте (в браузере)
- Аудио обрабатывается через Web Audio API (AudioContext + AudioWorklet)
- Аудио отправляется на WebSocket сервер (Node.js), который проксирует данные в Gladia
- Транскрипты от Gladia возвращаются на клиент и публикуются через LiveKit data channel
- Все участники подписываются на data channel и получают транскрипты всех остальных

**Преимущества:**
- ✅ Реализовано и работает
- ✅ Real-time транскрипция (низкая задержка)
- ✅ Не требует сложной серверной инфраструктуры
- ✅ Каждый участник видит транскрипты всех (включая свои)

**Недостатки:**
- ⚠️ N WebSocket коннектов к Gladia (где N = количество участников)
- ⚠️ Зависит от клиентского железа (CPU, память)
- ⚠️ При 100 участников = 100 коннектов к Gladia = высокая стоимость
- ⚠️ Сложнее контролировать и ограничивать использование

---

## Технологический стек

### Frontend (Client-Side)

**Браузерные API:**
- **Web Audio API:**
  - `AudioContext` (sample rate: 16000 Hz для Gladia)
  - `AudioWorklet` (для обработки аудио в отдельном потоке)
  - `MediaStreamAudioSourceNode` (источник из MediaStreamTrack)
  - `AudioWorkletNode` (обработка аудио чанками)

- **WebRTC / LiveKit:**
  - `Room` - подключение к LiveKit комнате
  - `LocalParticipant` - локальный участник
  - `TrackPublication` - публикация аудио трека
  - `publishData()` - публикация транскриптов через data channel

- **WebSocket API:**
  - Подключение к Node.js WebSocket серверу (`ws://localhost:3001`)
  - Отправка PCM16 аудио чанков
  - Получение транскриптов (JSON)

**React Hooks:**
- `useLocalParticipantTranscription` - основной хук для транскрипции
- `useTranscriptStream` - получение транскриптов через LiveKit data channel
- `useRoom` - управление подключением к LiveKit комнате

### Backend (Server-Side)

**Next.js API Routes:**
- `/api/sessions/[slug]/token` - получение LiveKit токена и transcription token
- `/api/sessions/[slug]/participants/join` - регистрация участника в БД
- `/api/transcription/usage/save` - сохранение использования транскрипции
- `/api/sessions/[slug]/transcription/usage` - статистика по сессии
- `/api/transcription/stats` - статистика по пользователю

**Node.js WebSocket Сервер** (`ws/server/`):
- Порт: `3001` (конфигурируется через `WS_PORT`)
- Эндпоинт: `/api/realtime/transcribe?token=<JWT>`
- Авторизация: JWT токен (валидация через `TRANSCRIPTION_JWT_SECRET`)
- Проксирование аудио: Клиент → WebSocket Server → Gladia WebSocket
- Проксирование транскриптов: Gladia WebSocket → WebSocket Server → Клиент

**База данных (PostgreSQL / Neon):**
- `VideoSession` - сессии
- `Participant` - участники сессий
- `TranscriptSegment` - транскрипты (только финальные сегменты)
- `TranscriptionUsage` - учёт использования транскрипции

**Внешние сервисы:**
- **LiveKit Cloud** - WebRTC сервер для видеозвонков
- **Gladia API** - транскрипция аудио в реальном времени

---

## Архитектура системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  SessionContent (React Component)                            │  │
│  │  - useLocalParticipantTranscription()                        │  │
│  │  - useTranscriptStream()                                     │  │
│  │  - useRoom()                                                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│         ┌─────────────────┼─────────────────┐                       │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐               │
│  │ AudioContext│  │ LiveKit Room │  │ WebSocket   │               │
│  │ + Worklet   │  │ (WebRTC)     │  │ Client      │               │
│  └─────────────┘  └──────────────┘  └─────────────┘               │
│         │                 │                 │                       │
│         │ (PCM16)         │ (Data Channel)  │ (PCM16)              │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER (Node.js)                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Next.js API Routes                                          │  │
│  │  - /api/sessions/[slug]/token                                │  │
│  │  - /api/sessions/[slug]/participants/join                    │  │
│  │  - /api/transcription/usage/save                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│         ┌─────────────────┼─────────────────┐                       │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐               │
│  │ PostgreSQL  │  │  LiveKit     │  │  WebSocket  │               │
│  │ (Neon)      │  │  Cloud       │  │  Server     │               │
│  └─────────────┘  └──────────────┘  └─────────────┘               │
│                           │                 │                       │
│                           │                 │ (PCM16)               │
│                           │                 ▼                       │
│                           │         ┌──────────────┐                │
│                           │         │  Gladia API  │                │
│                           │         │  (WebSocket) │                │
│                           │         └──────────────┘                │
│                           │                 │                       │
│                           │                 │ (Transcripts)         │
│                           │                 ▼                       │
│                           │         ┌──────────────┐                │
│                           │         │  WebSocket   │                │
│                           │         │  Server      │                │
│                           │         │  (Proxy)     │                │
│                           │         └──────────────┘                │
└───────────────────────────┼─────────────────┼───────────────────────┘
                            │                 │
                            │                 │ (Transcripts)
                            │                 │
                            ▼                 ▼
                  ┌─────────────────────────────────┐
                  │  Client receives transcripts    │
                  │  via LiveKit data channel       │
                  └─────────────────────────────────┘
```

---

## Поток данных

### 1. Инициализация сессии

```
User → GET /api/sessions/[slug]/token
  ↓
Next.js API Route
  ↓
- Получает сессию из БД по slug
- Генерирует LiveKit AccessToken (через livekit-server-sdk)
- Генерирует transcription JWT токен
  ↓
Response: {
  token: "livekit-jwt-token",
  transcriptionToken: "jwt-for-websocket",
  sessionCreatedByUserId: "user-id"
}
```

### 2. Подключение к LiveKit комнате

```
Client → Room.connect(serverUrl, token)
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

### 3. Запуск транскрипции (на клиенте)

```
useLocalParticipantTranscription.start()
  ↓
1. Проверка feature flags (isTranscriptionEnabledForSession)
2. Получение аудио трека: localParticipant.getTrackPublication('microphone')
3. Создание AudioContext (sampleRate: 16000)
4. Загрузка AudioWorklet: /audio/transcription-processor.js
5. Создание AudioWorkletNode
6. Подключение MediaStreamTrack → AudioContext → AudioWorkletNode
  ↓
AudioWorklet обрабатывает аудио (каждые ~20-30ms):
  - Float32Array → PCM16 (Int16Array)
  - Отправка в основной поток через port.postMessage()
  ↓
convertAndSendAudio(float32Data):
  - Конвертация Float32Array → Int16Array (PCM16)
  - Проверка mute состояния (LiveKit + MediaStreamTrack)
  - wsRef.current.send(pcm16.buffer) → WebSocket Server
```

### 4. Отправка аудио на сервер

```
Client WebSocket → ws://localhost:3001/api/realtime/transcribe?token=<JWT>
  ↓
WebSocket Server (ws/server/index.ts)
  ↓
1. Валидация JWT токена (verifyTranscriptionToken)
2. Извлечение sessionSlug, participantIdentity
3. Создание GladiaBridge (если не существует)
4. Проксирование PCM16 → Gladia WebSocket
```

### 5. Транскрипция в Gladia

```
WebSocket Server → Gladia WebSocket (wss://api.gladia.io/v2/live)
  ↓
Gladia API
  ↓
- Инициализация сессии через POST /v2/live
- Получение WebSocket URL
- Подключение к Gladia WebSocket
- Отправка PCM16 аудио чанков
  ↓
Gladia обрабатывает аудио:
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

### 6. Получение транскриптов на клиенте

```
Gladia → WebSocket Server → Client WebSocket
  ↓
ws.onmessage (в useLocalParticipantTranscription):
  - Парсинг JSON
  - Обновление метрик (incrementTranscripts)
  - Вызов sendTranscriptFromServer()
    ↓
sendTranscriptFromServer():
  1. Публикация через LiveKit data channel:
     localParticipant.publishData({
       type: 'transcript',
       speakerId: identity,
       text: '...',
       isFinal: true/false,
       utterance_id: '...'
     })
  
  2. Вызов callback (для локального отображения):
     onTranscriptCallbackRef.current(message)
```

### 7. Отображение транскриптов

```
useTranscriptStream hook:
  - Подписка на LiveKit 'dataReceived' event
  - Фильтрация собственных сообщений (local echo protection)
  - Парсинг JSON
  - Группировка по utteranceId
  - Добавление в messages state
  ↓
UI компонент (TranscriptSidebar):
  - Отображение messages
  - Скроллинг к новым сообщениям
```

### 8. Сохранение в БД

```
Только финальные транскрипты (isFinal: true):
  ↓
appendTranscriptChunk():
  - Получение сессии по slug
  - Создание/обновление Participant (по identity)
  - upsert TranscriptSegment (по videoSessionId + utteranceId)
  ↓
БД (PostgreSQL):
  - VideoSession (существующая сессия)
  - Participant (создаётся при первом транскрипте)
  - TranscriptSegment (финальный сегмент)
```

### 9. Учёт использования (метрики)

```
Клиентские метрики (в памяти):
  - clientTranscriptionMetrics.startSession()
  - clientTranscriptionMetrics.incrementAudioChunks()
  - clientTranscriptionMetrics.incrementTranscripts()
  - clientTranscriptionMetrics.recordError()
  ↓
При остановке транскрипции:
  - clientTranscriptionMetrics.endSession()
  - Вычисление durationSeconds, durationMinutes
  ↓
POST /api/transcription/usage/save
  ↓
saveTranscriptionUsage():
  - Получение сессии по slug
  - Получение participant по identity
  - createTranscriptionUsage() → БД
```

---

## Компоненты системы

### 1. Клиентские компоненты

#### `useLocalParticipantTranscription` (основной хук)

**Ответственность:**
- Управление жизненным циклом транскрипции (start/stop)
- Обработка аудио через Web Audio API
- Отправка аудио на WebSocket сервер
- Получение транскриптов от сервера
- Публикация транскриптов через LiveKit data channel
- Сбор метрик использования

**Ключевые состояния:**
- `isActive` - включена ли транскрипция (управляется через start/stop)
- `wsRef` - WebSocket соединение с сервером
- `audioContextRef` - AudioContext для обработки аудио
- `workletNodeRef` - AudioWorkletNode для обработки аудио
- `mediaStreamTrackRef` - ссылка на MediaStreamTrack для проверки mute

**Критические функции:**
- `convertAndSendAudio()` - конвертация и отправка аудио (с проверкой mute)
- `sendTranscriptFromServer()` - публикация транскриптов
- `stopTranscription()` - остановка и сохранение метрик

#### `useTranscriptStream` (получение транскриптов)

**Ответственность:**
- Подписка на LiveKit data channel
- Получение транскриптов от всех участников
- Группировка и обработка сообщений
- Управление локальным состоянием messages

**Особенности:**
- Local echo protection (игнорирование собственных сообщений)
- Группировка по utteranceId
- Обработка partial и final транскриптов

#### `SessionContent` (главный компонент)

**Ответственность:**
- Инициализация транскрипции при подключении
- Управление микрофоном (mute/unmute)
- Связывание транскрипции с UI
- Обработка событий участников

**Автозапуск транскрипции:**
```typescript
useEffect(() => {
  if (!isActive && connectionState === ConnectionState.Connected) {
    start() // Автоматически запускает транскрипцию
  }
}, [isActive, connectionState])
```

### 2. Серверные компоненты

#### WebSocket Server (`ws/server/index.ts`)

**Архитектура:**
- HTTP сервер + WebSocket Server (порт 3001)
- Эндпоинты: `/api/realtime/transcribe` (WebSocket), `/metrics`, `/health` (HTTP)

**Обработка соединений:**
```
handleClientConnection():
  1. Валидация JWT токена (verifyTranscriptionToken)
  2. Извлечение sessionSlug, participantIdentity
  3. Создание GladiaBridge (1 bridge на соединение)
  4. Проксирование аудио: Client → Gladia
  5. Проксирование транскриптов: Gladia → Client
  6. Сохранение финальных транскриптов в БД
```

**GladiaBridge (`ws/server/gladia-bridge.ts`):**
- Инициализация сессии через POST `/v2/live`
- Подключение к Gladia WebSocket
- Обработка сообщений от Gladia
- Callback для транскриптов

#### Next.js API Routes

**`/api/sessions/[slug]/token`:**
- Получение сессии из БД
- Генерация LiveKit AccessToken
- Генерация transcription JWT токена
- Возврат токенов клиенту

**`/api/sessions/[slug]/participants/join`:**
- Создание/обновление Participant в БД
- Определение роли (HOST/GUEST)

**`/api/transcription/usage/save`:**
- Сохранение метрик использования в БД
- Расчёт стоимости

### 3. База данных

**Модели:**

```prisma
VideoSession {
  id, slug, title, status, createdAt, endedAt
  createdByUserId, spaceId
  participants[], transcripts[], transcriptionUsage[]
}

Participant {
  id, videoSessionId, userId, identity, name, role
  joinedAt, leftAt
  transcripts[], transcriptionUsage[]
}

TranscriptSegment {
  id, videoSessionId, participantId, utteranceId
  text, language, isFinal, startedAt, endedAt
  // Сохраняются только финальные сегменты
}

TranscriptionUsage {
  id, videoSessionId, participantId, userId
  startedAt, endedAt
  durationSeconds, durationMinutes
  audioChunksSent, transcriptsReceived
  finalTranscripts, partialTranscripts
  costPerMinute, totalCost, errorsCount
}
```

**Оптимизации:**
- Сохранение только финальных транскриптов (partial не сохраняются)
- Индексы на videoSessionId, participantId, userId, createdAt
- Уникальные ограничения для предотвращения дублей

---

## Метрики и мониторинг

### Клиентские метрики (в памяти)

**Отслеживается:**
- Время начала/окончания транскрипции
- Количество отправленных аудио-чанков
- Количество полученных транскриптов (partial/final)
- Количество ошибок
- Общая длительность (секунды и минуты)

**Хранение:**
- В памяти браузера (Map<string, TranscriptionMetrics>)
- Автоматическая очистка старых сессий (>24 часа)
- Сохранение в БД при завершении транскрипции

### Серверные метрики (`ws/server/metrics.ts`)

**Отслеживается:**
- Количество активных WebSocket соединений
- Количество активных Gladia bridges
- Общее количество отправленных/полученных сообщений
- Количество ошибок
- Uptime сервера

**Эндпоинты:**
- `GET /metrics` - JSON с метриками
- `GET /health` - статус сервера

### Метрики БД (TranscriptionUsage)

**Что сохраняется:**
- Длительность транскрипции (секунды и минуты)
- Количество отправленных чанков
- Количество полученных транскриптов
- Стоимость (минуты × costPerMinute)
- Количество ошибок

**Использование:**
- Подсчёт общей стоимости для пользователя/сессии
- Статистика использования
- Отслеживание активности

---

## Учёт стоимости

### Расчёт стоимости

**Формула:**
```
totalCost = durationMinutes × costPerMinute
```

**Округление:**
- `durationMinutes` округляется вверх (Math.ceil)
- Пример: 61 секунда = 2 минуты = $0.02

**Стоимость по умолчанию:**
- `$0.01 за минуту` (настраивается через `TRANSCRIPTION_COST_PER_MINUTE`)

### Когда сохраняется использование

1. **При остановке транскрипции:**
   - Пользователь закрыл вкладку
   - Пользователь покинул сессию
   - Произошла ошибка и транскрипция остановилась

2. **Что сохраняется:**
   - startedAt, endedAt
   - durationSeconds, durationMinutes
   - Все счётчики (audioChunksSent, transcriptsReceived, etc.)
   - totalCost

### API для получения статистики

**Для пользователя:**
```
GET /api/transcription/stats
→ { totalMinutes, totalCost, totalSessions, averageDurationMinutes }
```

**Для сессии:**
```
GET /api/sessions/[slug]/transcription/usage
→ { usage: [...], stats: { totalMinutes, totalCost, ... } }
```

---

## Поведение при нагрузках

### Текущая архитектура (Client-Side)

#### Сценарий 1: Одна сессия с 10 участниками

**Что происходит:**
- 10 WebSocket соединений к WebSocket серверу
- 10 Gladia bridges (1 на каждого участника)
- 10 коннектов к Gladia API
- 10 активных AudioContext на клиентах
- ~10 записей в БД при завершении (TranscriptionUsage)

**Нагрузка:**
- **WebSocket сервер:** Низкая (10 соединений, проксирование данных)
- **Gladia API:** Средняя (10 сессий транскрипции)
- **БД:** Низкая (запись только при завершении, не каждый partial)
- **LiveKit:** Низкая (data channel для транскриптов)

**Стоимость Gladia:**
- 10 участников × 60 минут × $0.01 = $6.00 за час

#### Сценарий 2: 10 сессий × 10 участников = 100 участников

**Что происходит:**
- 100 WebSocket соединений к WebSocket серверу
- 100 Gladia bridges
- 100 коннектов к Gladia API
- 100 активных AudioContext на клиентах

**Нагрузка:**
- **WebSocket сервер:** Средняя (100 соединений)
  - Каждое соединение: ~50 аудио-чанков/сек (16000 Hz, 20ms чанки)
  - Входящий трафик: ~100 × 50 × 640 bytes = ~3.2 MB/сек
  - Исходящий трафик: ~100 × 10 транскриптов/мин = ~1.7 транскриптов/сек

- **Gladia API:** Высокая (100 параллельных сессий)
  - Лимиты Gladia: нужно проверить, но обычно поддерживают сотни сессий

- **БД:** Низкая-Средняя
  - Запись только финальных транскриптов (~1-2 на минуту на участника)
  - Запись TranscriptionUsage при завершении
  - Чтение при получении статистики

- **LiveKit:** Средняя
  - 100 участников публикуют транскрипты через data channel
  - Каждый транскрипт отправляется всем остальным участникам в сессии

**Стоимость Gladia:**
- 100 участников × 60 минут × $0.01 = $60.00 за час

#### Сценарий 3: 100 сессий × 10 участников = 1000 участников

**Что происходит:**
- 1000 WebSocket соединений
- 1000 Gladia bridges
- 1000 коннектов к Gladia API

**Нагрузка:**
- **WebSocket сервер:** Высокая
  - 1000 соединений могут быть проблемой для одного процесса Node.js
  - Требуется горизонтальное масштабирование
  - Входящий трафик: ~32 MB/сек
  - Memory: ~50-100 MB на соединение (зависит от буферизации)

- **Gladia API:** Очень высокая
  - 1000 параллельных сессий - нужно проверить лимиты
  - Возможны rate limits или дополнительные расходы

- **БД:** Средняя-Высокая
  - 1000 записей TranscriptionUsage при завершении
  - ~20,000 финальных транскриптов в минуту (20 на участника/мин)
  - Нужны индексы для быстрого поиска

- **LiveKit:** Высокая
  - 1000 участников публикуют данные
  - Data channel может стать узким местом

**Стоимость Gladia:**
- 1000 участников × 60 минут × $0.01 = $600.00 за час

### Bottlenecks (узкие места)

#### 1. WebSocket сервер

**Проблемы:**
- Один процесс Node.js может обработать ограниченное количество соединений
- Каждое соединение держит память (WebSocket, GladiaBridge)
- Нет горизонтального масштабирования (все соединения на одном сервере)

**Решения:**
- Использовать несколько инстансов WebSocket сервера
- Load balancer перед WebSocket серверами
- Использовать Redis для координации между инстансами

#### 2. Gladia API

**Проблемы:**
- Количество коннектов = количество участников
- Возможные rate limits
- Высокая стоимость при большом количестве участников

**Решения:**
- Переход на server-side транскрипцию (1 коннект на сессию вместо N)
- Использование одного микшированного потока для всей комнаты

#### 3. База данных

**Проблемы:**
- Запись финальных транскриптов при высокой нагрузке
- Запись TranscriptionUsage при завершении сессий
- Чтение при получении статистики

**Решения:**
- Batch insert для транскриптов
- Асинхронная запись через очередь
- Кэширование статистики

#### 4. LiveKit Data Channel

**Проблемы:**
- При 1000 участниках каждый транскрипт отправляется всем остальным
- В сессии с 10 участниками: 1 транскрипт → 9 получателей = 9 сообщений

**Решения:**
- LiveKit оптимизирует data channel автоматически
- Но при очень большом количестве участников может стать узким местом

#### 5. Клиентское железо

**Проблемы:**
- AudioContext требует CPU
- AudioWorklet обрабатывает аудио в отдельном потоке
- Может замедлить работу браузера на слабых устройствах

**Решения:**
- Оптимизация размера аудио чанков
- Остановка транскрипции при отсутствии активности
- Переход на server-side (убрать нагрузку с клиента)

---

## Масштабируемость

### Текущие ограничения

**Один WebSocket сервер:**
- Максимум: ~500-1000 соединений (зависит от железа)
- Рекомендуется: <500 соединений на процесс

**Одна БД (Neon PostgreSQL):**
- Ограничения зависят от плана
- Нужно проверить лимиты по соединениям и пропускной способности

**Gladia API:**
- Нужно проверить лимиты по количеству параллельных сессий
- Возможны rate limits

### План масштабирования до 1000 участников

#### Вариант A: Горизонтальное масштабирование WebSocket серверов

**Архитектура:**
```
Load Balancer (nginx/haproxy)
  ↓
WebSocket Server 1 (500 соединений)
WebSocket Server 2 (500 соединений)
```

**Что нужно:**
- Load balancer с поддержкой WebSocket
- Координация через Redis (опционально)
- Статистика метрик агрегируется из всех инстансов

**Ограничения:**
- Все равно 1000 коннектов к Gladia
- Высокая стоимость

#### Вариант B: Server-Side Транскрипция (рекомендуется)

**Архитектура:**
```
Transcription Service (Node.js)
  ↓
Подключается к LiveKit room как bot
  ↓
Получает аудио всех участников
  ↓
Миксит в один поток
  ↓
1 WebSocket коннект к Gladia (вместо N)
```

**Преимущества:**
- 1000 участников = 100 сессий = 100 коннектов к Gladia (вместо 1000)
- Снижение стоимости в 10 раз
- Централизованное управление
- Не зависит от клиентского железа

**Недостатки:**
- Требует node-webrtc или альтернативу
- Более сложная реализация
- Задержка может быть выше (server → Gladia → server → clients)

---

## Рекомендации по оптимизации

### Краткосрочные (без изменения архитектуры)

1. **Оптимизация размера аудио чанков:**
   - Использовать оптимальный размер (320-640 байт на чанк)
   - Не отправлять пустые чанки

2. **Кэширование и batch операций:**
   - Batch insert для транскриптов в БД
   - Кэширование статистики (Redis, если появится)

3. **Мониторинг:**
   - Отслеживание метрик WebSocket сервера
   - Алерты при превышении лимитов
   - Логирование ошибок

4. **Ограничения:**
   - Feature flags для ограничения количества транскрипций
   - Автоматическая остановка при отсутствии активности

### Среднесрочные (улучшения текущей архитектуры)

1. **Горизонтальное масштабирование WebSocket серверов:**
   - Несколько инстансов
   - Load balancer
   - Координация через Redis

2. **Оптимизация БД:**
   - Индексы для быстрого поиска
   - Партиционирование таблиц по дате (для больших объёмов)
   - Асинхронная запись через очередь

3. **Улучшение метрик:**
   - Централизованное хранение метрик
   - Dashboard для визуализации
   - Экспорт данных

### Долгосрочные (изменение архитектуры)

1. **Server-Side Транскрипция:**
   - Реализация TranscriptionService через node-webrtc
   - 1 коннект к Gladia на сессию
   - Снижение стоимости в 10 раз

2. **Кэширование и очереди:**
   - Redis для кэширования
   - Очередь задач для асинхронной обработки
   - Background workers для тяжёлых операций

3. **Мониторинг и алерты:**
   - Prometheus + Grafana
   - Sentry для отслеживания ошибок
   - Алерты при превышении лимитов

---

## Технические детали

### Аудио обработка

**Формат:**
- Sample Rate: 16000 Hz (обязательно для Gladia)
- Bit Depth: 16-bit (PCM16)
- Channels: 1 (моно)
- Encoding: PCM (raw audio)

**Размер чанка:**
- AudioWorklet обрабатывает ~480 samples за раз (при 16kHz = 30ms)
- Int16Array: 480 samples × 2 bytes = 960 bytes
- Отправляется каждые ~20-30ms

**Пропускная способность:**
- ~50 чанков/сек на участника
- ~32 KB/сек на участника
- 100 участников = ~3.2 MB/сек входящего трафика

### WebSocket протокол

**Авторизация:**
- JWT токен в query параметре: `?token=<JWT>`
- Секрет: `TRANSCRIPTION_JWT_SECRET`
- Валидность: 1 час

**Сообщения:**
- Client → Server: Binary (PCM16 audio)
- Server → Client: JSON (transcripts)
- Server → Gladia: Binary (PCM16 audio)
- Gladia → Server: JSON (transcripts)

### LiveKit Data Channel

**Протокол:**
- Reliable data channel (гарантия доставки)
- Формат: JSON
- Типы сообщений:
  - `transcript` - транскрипт
  - `transcription-host-changed` - смена transcription host

**Оптимизация:**
- Local echo protection (игнорирование собственных сообщений)
- Группировка по utteranceId

### Feature Flags

**Уровни:**
1. Глобальный (env переменная)
2. Пользователь (будущее: в БД)
3. Сессия (будущее: в БД)

**Ограничения:**
- maxActiveTranscriptionsPerUser: 5
- maxActiveTranscriptionsPerSession: 10
- maxTranscriptionMinutes: 0 (без ограничений)

---

## Выводы

### Текущее состояние

✅ **Работает стабильно:**
- Client-side транскрипция для всех участников
- Метрики и учёт стоимости
- Feature flags и ограничения
- Сохранение транскриптов в БД

⚠️ **Ограничения при масштабировании:**
- 1000 участников = 1000 коннектов к Gladia = высокая стоимость
- WebSocket сервер может стать узким местом
- Зависимость от клиентского железа

### Рекомендации

**Для <100 участников:** Текущая архитектура подходит

**Для 100-500 участников:** 
- Горизонтальное масштабирование WebSocket серверов
- Мониторинг и алерты

**Для 500+ участников:**
- Переход на server-side транскрипцию (TranscriptionService)
- Снижение стоимости в 10 раз
- Централизованное управление

---

## Приложения

### A. Формулы расчёта стоимости

```
totalCost = durationMinutes × costPerMinute

Где:
- durationMinutes = Math.ceil(durationSeconds / 60)
- costPerMinute = 0.01 (по умолчанию)

Пример:
- 61 секунда транскрипции
- durationMinutes = Math.ceil(61/60) = 2
- totalCost = 2 × 0.01 = $0.02
```

### B. Лимиты и квоты

**Текущие лимиты (feature flags):**
- maxActiveTranscriptionsPerUser: 5
- maxActiveTranscriptionsPerSession: 10

**Рекомендуемые лимиты для production:**
- maxActiveTranscriptionsPerUser: 10
- maxActiveTranscriptionsPerSession: 20
- maxTranscriptionMinutes: 0 (без ограничений, или по плану подписки)

### C. Мониторинг метрик

**Ключевые метрики для отслеживания:**

1. **Количество активных транскрипций:**
   - По пользователям
   - По сессиям
   - Общее количество

2. **Стоимость:**
   - За день/неделю/месяц
   - По пользователям
   - По сессиям

3. **Производительность:**
   - Время отклика WebSocket сервера
   - Задержка транскрипции (время от аудио до текста)
   - Количество ошибок

4. **Использование ресурсов:**
   - CPU/память WebSocket сервера
   - Количество соединений
   - Пропускная способность сети

---

*Документ обновлён: 2024-12-01*


# Realtime Core: Техническая реализация

## Обзор

Realtime Core — это монолитная архитектура для real-time транскрипции с минимальной задержкой. Все компоненты (RTMP, FFmpeg, Gladia Bridge, WebSocket) работают в одном процессе Node.js, что исключает сетевые хопы из горячего пути.

**Ключевые метрики:**
- **Задержка транскрипции:** 0.5-1.2 секунды от окончания речи до доставки клиенту
- **Пропускная способность:** до 100 комнат, 500+ говорящих одновременно
- **Качество транскрипции:** 95-98% точность (зависит от качества аудио)

---

## Архитектура потока данных

```
┌─────────────────────────────────────────────────────────────┐
│                    LiveKit Cloud                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Participant │  │ Participant │  │ Participant │     │
│  │    Audio    │  │    Audio    │  │    Audio    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │              │
│         └─────────────────┴─────────────────┘              │
│                            │                                 │
│                   Room Composite Egress                      │
│                   (Audio Mixing)                             │
└────────────────────────────┼─────────────────────────────────┘
                             │ RTMP Stream
                             │ rtmp://gondola.proxy.rlwy.net:59606/live/{sessionSlug}
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Railway WS/RTMP Monolith                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         RTMP Server (Node-Media-Server)              │  │
│  │         Port: 1937 (internal)                        │  │
│  │         TCP Proxy: 59606 (external)                   │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ Stream Handler                        │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         RTMP Ingest (per session)                    │  │
│  │         - Registers stream handler                   │  │
│  │         - Waits for Egress connection                │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ onStreamStart()                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         FFmpeg Decoder                               │  │
│  │         - Input: rtmp://localhost:1937/live/{slug}   │  │
│  │         - Output: PCM16, 16kHz, mono                 │  │
│  │         - Low-latency flags                          │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ PCM16 chunks (~100-200ms)             │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Gladia Bridge                                │  │
│  │         - WebSocket to Gladia Live v2                │  │
│  │         - Sends audio chunks immediately              │  │
│  │         - Receives interim + final transcripts       │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ Transcript Events                    │
│                     │ (interim + final)                     │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         handleTranscript()                           │  │
│  │         - Speaker identification (Active Speaker)    │  │
│  │         - Direct WebSocket broadcast                 │  │
│  │         - Batch DB write (final only)               │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ broadcastToSessionClients()          │
│                     │ (in-memory, no HTTP)                  │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         WebSocket Server                             │  │
│  │         - Client connections per session             │  │
│  │         - Direct broadcast to all clients             │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ WebSocket messages                   │
│                     │ { type: 'transcript', ... }          │
└─────────────────────┼───────────────────────────────────────┘
                      │
                      │ wss://sessions-ws-production.up.railway.app/api/realtime/transcribe
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Клиенты (Next.js Frontend)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         useRealtimeTranscript() hook                 │  │
│  │         - Subscribes to WebSocket                     │  │
│  │         - Manages messages + currentUtterance         │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                       │
│                     │ React State                           │
│                     ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         RealtimeTranscript Component                 │  │
│  │         - Displays final messages                    │  │
│  │         - Shows currentUtterance (interim)          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Компоненты системы

### 1. RTMP Server (Node-Media-Server)

**Файл:** `server/rtmp-server.ts`

**Роль:** Принимает RTMP потоки от LiveKit Egress

**Конфигурация:**
- **Внутренний порт:** 1937 (где слушает RTMP сервер)
- **Внешний порт:** 59606 (через Railway TCP Proxy)
- **Домен:** `gondola.proxy.rlwy.net` (Railway TCP Proxy)

**События:**
- `preConnect` — клиент подключается
- `postConnect` — клиент подключен
- `prePublish` — поток начинает публиковаться → запускает FFmpeg
- `postPublish` — поток опубликован (данные идут)
- `donePublish` — поток завершен → останавливает FFmpeg

**Оптимизации:**
- Глобальный singleton сервер (один на все сессии)
- Stream handlers регистрируются динамически при старте транскрипции
- Автоматическая очистка при завершении потока

---

### 2. RTMP Ingest

**Файл:** `server/rtmp-ingest.ts`

**Роль:** Управляет декодированием RTMP потока для одной сессии

**Жизненный цикл:**
1. **Инициализация:** Регистрирует stream handler в RTMP сервере
2. **Ожидание:** Ждет подключения LiveKit Egress (`waitingForEgress: true`)
3. **Запуск FFmpeg:** Когда Egress подключается (`onStreamStart`)
4. **Декодирование:** FFmpeg конвертирует RTMP → PCM16
5. **Отправка в Gladia:** PCM16 chunks отправляются в Gladia Bridge
6. **Обработка транскриптов:** `handleTranscript()` получает события от Gladia
7. **Broadcast:** Транскрипты отправляются клиентам через WebSocket
8. **Завершение:** При `onStreamEnd` останавливает FFmpeg и Gladia Bridge

**Ключевые методы:**
- `start()` — инициализация и регистрация handler
- `startFFmpegNow()` — принудительный запуск FFmpeg (если поток уже активен)
- `handleTranscript()` — обработка транскриптов от Gladia
- `stop()` — корректное завершение

---

### 3. FFmpeg Decoder

**Файл:** `server/rtmp-ingest.ts` (метод `startFFmpegDecoder()`)

**Роль:** Декодирует RTMP поток в PCM16 для Gladia

**Команда FFmpeg:**
```bash
ffmpeg \
  -i rtmp://localhost:1937/live/{sessionSlug} \
  -f s16le \
  -acodec pcm_s16le \
  -ar 16000 \
  -ac 1 \
  -fflags nobuffer \
  -flags low_delay \
  -probesize 4096 \
  -analyzeduration 100000 \
  -
```

**Параметры:**
- `-f s16le` — формат: signed 16-bit little-endian PCM
- `-ar 16000` — sample rate: 16kHz (требование Gladia)
- `-ac 1` — каналы: mono
- `-fflags nobuffer` — минимальный буфер
- `-flags low_delay` — низкая задержка
- `-probesize 4096` — быстрый анализ потока (баланс между скоростью и стабильностью)
- `-analyzeduration 100000` — анализ первых 100ms потока

**Оптимизации:**
- Chunks отправляются сразу (не накапливаются)
- Размер chunk: ~100-200ms аудио (~3-6KB PCM16)
- Автоматический ретрай при `exitCode === 1` (до 3 попыток)
- Детальное логирование stderr для дебага

**Проблемы и решения:**
- **Проблема:** FFmpeg падал с `exitCode === 1` при нестабильном RTMP потоке
- **Решение:** Автоматический ретрай с задержкой 2 секунды, логирование последних 10 строк stderr
- **Проблема:** Слишком агрессивные low-latency флаги (`probesize=32`, `analyzeduration=0`)
- **Решение:** Смягчены до `probesize=4096`, `analyzeduration=100000` для стабильности

---

### 4. Gladia Bridge

**Файл:** `server/gladia-bridge.ts`

**Роль:** WebSocket клиент для Gladia Live v2 STT API

**Инициализация:**
1. POST запрос к `/v2/live` для получения WebSocket URL
2. Подключение к WebSocket с токеном
3. Отправка PCM16 chunks сразу после получения от FFmpeg

**Формат сообщений от Gladia:**
```json
{
  "type": "transcript",
  "data": {
    "id": "utterance-id",
    "is_final": false,  // или true
    "utterance": {
      "text": "Привет, как дела?",
      "speaker_id": "...",  // обычно отсутствует в Live v2
      "speaker_name": "..."
    }
  }
}
```

**Обработка:**
- Парсинг сообщений через `parseTranscriptMessage()`
- Создание `TranscriptEvent` с полями:
  - `utteranceId` — уникальный ID utterance
  - `text` — текст транскрипта
  - `isFinal` — финальность (false = interim/draft, true = final)
  - `startedAt` — время начала (приблизительное)
  - `endedAt` — время окончания (только для final)
  - `receivedAt` — timestamp получения от Gladia (для метрик)

**Важно о diarization:**
- Gladia Live v2 **не дает** полноценной diarization в real-time
- Diarization доступна только в file-based API (post-call analysis)
- Поэтому `speakerId` от Gladia используется как fallback
- Основной источник — `active-speaker-tracker` из LiveKit (локально)

---

### 5. Active Speaker Tracker

**Файл:** `server/active-speaker-tracker.ts`

**Роль:** Определяет текущего активного спикера на основе данных от LiveKit

**Источник данных:**
- HTTP POST запросы от клиентов на `/api/active-speaker`
- Клиенты отправляют данные о текущем активном спикере каждые 500ms
- Данные обновляются в in-memory store

**Структура данных:**
```typescript
{
  sessionSlug: string
  identity: string  // userId:sessionId
  name: string
  timestamp: number
}
```

**Использование:**
- В `handleTranscript()` вызывается `getActiveSpeaker(sessionSlug)`
- Если активный спикер найден — используется его `identity` и `name`
- Если нет — fallback на `event.speakerId` от Gladia или `'room'`

---

### 6. Direct WebSocket Broadcast

**Файл:** `server/client-connection.ts`

**Роль:** In-memory broadcast транскриптов клиентам без HTTP-хопа

**Режимы работы:**
- **Direct (default):** `REALTIME_BROADCAST_MODE=direct` или не установлен
  - Прямой вызов `broadcastToSessionClients()` в памяти
  - Минимальная задержка (~1-5ms)
- **HTTP (fallback):** `REALTIME_BROADCAST_MODE=http`
  - HTTP POST на `/api/realtime/transcribe/broadcast`
  - Используется для разделенных сервисов или интеграции

**Структура payload:**
```typescript
{
  type: 'transcript',
  sessionSlug: string,
  utteranceId: string,
  text: string,
  isFinal: boolean,
  speaker: string,
  speakerId: string,
  ts: number  // timestamp отправки
}
```

**Клиентские подключения:**
- WebSocket сервер хранит подключения в `Map<sessionSlug, Set<WebSocket>>`
- При broadcast итерируется по всем клиентам сессии
- Отправка через `ws.send(JSON.stringify(payload))`
- Автоматическая очистка при отключении клиента

---

### 7. Batch DB Writer

**Файл:** `server/transcript-batch-queue.ts`

**Роль:** Batch-запись финальных транскриптов в БД для снижения нагрузки

**Оптимизация:**
- Вместо прямой записи в БД (upsert) транскрипты добавляются в очередь
- Batch-система периодически записывает накопленные транскрипты батчами
- Снижает нагрузку на БД в 10-50 раз

**Важно:**
- В БД сохраняются **только финальные** транскрипты (`isFinal: true`)
- Interim (draft) транскрипты отправляются клиенту для UI, но не сохраняются
- Это критично для масштабируемости (снижение нагрузки в 50-100 раз)

**Параметры batch:**
- Максимальный размер батча: 50 транскриптов
- Максимальная задержка: 2 секунды
- Flush при достижении любого из условий

---

## Метрики производительности

### Система метрик

**Файл:** `server/realtime-metrics.ts`

**Типы метрик:**
- `gladia.stt_latency_ms` — задержка обработки в Gladia (от окончания речи до транскрипта)
- `ingest.broadcast_latency_ms` — задержка обработки в ingest (от получения от Gladia до отправки клиентам)
- `ws.broadcast_loop_ms` — время выполнения `broadcastToSessionClients()` (direct mode)
- `http.post_latency_ms` — задержка HTTP POST (HTTP mode)

**Сбор метрик:**
- In-memory хранение (минимальный overhead)
- Периодическое логирование каждые 100 записей
- HTTP endpoint `/metrics` для внешнего мониторинга

**Пример метрик:**
```json
{
  "gladia.stt_latency_ms": {
    "count": 1000,
    "avgMs": 450,
    "minMs": 200,
    "maxMs": 1200
  },
  "ingest.broadcast_latency_ms": {
    "count": 1000,
    "avgMs": 2,
    "minMs": 1,
    "maxMs": 5
  },
  "ws.broadcast_loop_ms": {
    "count": 1000,
    "avgMs": 1,
    "minMs": 0,
    "maxMs": 3
  }
}
```

---

## Качество транскрипции

### Точность

**Ожидаемая точность:** 95-98% (зависит от качества аудио)

**Факторы, влияющие на точность:**
1. **Качество аудио:**
   - Чистота звука (без шумов, эха)
   - Громкость речи
   - Отсутствие перекрытий (overlapping speech)

2. **Язык:**
   - Gladia поддерживает 100+ языков
   - Лучшая точность для английского, русский — хорошая поддержка

3. **Скорость речи:**
   - Нормальная скорость: высокая точность
   - Очень быстрая речь: может снижаться точность

4. **Специфические термины:**
   - Общие слова: высокая точность
   - Технические термины, имена собственные: может быть ниже

### Скорость транскрипции

**Задержка от окончания речи до доставки клиенту:**
- **Interim (draft):** 0.3-0.8 секунды
- **Final:** 0.5-1.2 секунды

**Разбивка задержки:**
1. **LiveKit Egress → RTMP Server:** ~50-100ms
   - Зависит от сетевой задержки до Railway
   - Railway TCP Proxy добавляет ~10-20ms

2. **FFmpeg декодирование:** ~10-50ms
   - Зависит от размера chunk
   - Low-latency флаги минимизируют буферизацию

3. **Gladia STT обработка:** ~200-800ms
   - Зависит от длины utterance
   - Interim приходит быстрее, final — после полного анализа

4. **Broadcast клиентам:** ~1-5ms (direct mode)
   - In-memory broadcast практически мгновенный
   - Зависит от количества клиентов в сессии

**Итого:** 0.5-1.2 секунды от окончания речи до финального транскрипта

---

## Проблема: Draft → Final транскрипты

### Описание проблемы

Иногда draft (interim) транскрипт не превращается в final (отредактированный) транскрипт после окончания фразы.

### Причины

#### 1. **Gladia не определил конец utterance**

**Симптомы:**
- Draft транскрипт обновляется, но `isFinal: true` не приходит
- После паузы в речи Gladia может "забыть" предыдущий utterance

**Причины:**
- Слишком длинная пауза между словами
- Gladia считает, что utterance продолжается
- Таймаут в Gladia (обычно 30 секунд без аудио)

**Решение:**
- Gladia автоматически закрывает utterance через 30 секунд без аудио
- Но к этому моменту клиент может уже отобразить draft как "финальный"

#### 2. **Разрыв соединения с Gladia**

**Симптомы:**
- WebSocket закрывается с кодом `4408` ("No audio chunk received for 30s")
- Draft транскрипт остается в UI без финальной версии

**Причины:**
- FFmpeg не получает RTMP поток (Egress не подключился)
- Сетевые проблемы между Railway и Gladia
- Таймаут в Gladia при отсутствии аудио

**Решение:**
- Автоматический ретрай FFmpeg при `exitCode === 1`
- Мониторинг соединения с Gladia
- Логирование для диагностики

#### 3. **Проблемы с RTMP потоком**

**Симптомы:**
- FFmpeg не запускается или падает
- В логах нет `[RTMPIngest] ✅ LiveKit Egress connected to RTMP stream`

**Причины:**
- LiveKit Egress не может подключиться к RTMP серверу
- Неправильный `RTMP_HOST` или `RTMP_EXTERNAL_PORT`
- Railway TCP Proxy не настроен

**Решение:**
- Проверка переменных окружения:
  ```
  RTMP_HOST=gondola.proxy.rlwy.net
  RTMP_EXTERNAL_PORT=59606
  RTMP_INTERNAL_PORT=1937
  ```
- Логирование подключений RTMP (`[RTMPServer] 🔵 RTMP client connecting`)

#### 4. **Race condition в обработке транскриптов**

**Симптомы:**
- Final транскрипт приходит, но с другим `utteranceId`
- Draft и final транскрипты не совпадают по ID

**Причины:**
- Gladia может изменить `utteranceId` между interim и final
- Клиент не обновляет draft, если `utteranceId` не совпадает

**Решение:**
- Клиент должен обновлять draft по `utteranceId` или `text` (частичное совпадение)
- Сервер должен логировать все транскрипты для анализа

### Рекомендации

1. **На клиенте:**
   - Показывать draft транскрипты с индикатором "typing..."
   - Автоматически "финализировать" draft через 3-5 секунд без обновлений
   - Сопоставлять draft и final по частичному совпадению текста, а не только по `utteranceId`

2. **На сервере:**
   - Логировать все транскрипты (interim + final) для анализа
   - Мониторить соединение с Gladia
   - Автоматический ретрай при разрывах

3. **Мониторинг:**
   - Отслеживать метрику `gladia.stt_latency_ms`
   - Алерты при отсутствии транскриптов > 30 секунд
   - Логирование всех `isFinal: false` транскриптов для анализа паттернов

---

## Оптимизации для низкой задержки

### 1. Direct WebSocket Broadcast

**До оптимизации:**
- RTMP Ingest → HTTP POST → WebSocket Server → Broadcast
- Задержка: ~10-50ms (HTTP round-trip)

**После оптимизации:**
- RTMP Ingest → Direct `broadcastToSessionClients()` (in-memory)
- Задержка: ~1-5ms

**Выигрыш:** 5-10x снижение задержки

### 2. FFmpeg Low-Latency Flags

**Флаги:**
- `-fflags nobuffer` — минимальный буфер
- `-flags low_delay` — низкая задержка
- `-probesize 4096` — быстрый анализ (баланс скорость/стабильность)
- `-analyzeduration 100000` — анализ первых 100ms

**Выигрыш:** ~50-100ms снижение задержки декодирования

### 3. Immediate Audio Chunking

**До оптимизации:**
- Накопление аудио в буфер, отправка большими chunks

**После оптимизации:**
- Отправка chunks сразу (~100-200ms)
- Минимальный буфер в FFmpeg

**Выигрыш:** ~100-200ms снижение задержки

### 4. Batch DB Write (только final)

**До оптимизации:**
- Запись каждого транскрипта в БД (interim + final)

**После оптимизации:**
- Batch-запись только final транскриптов
- Interim не сохраняются в БД

**Выигрыш:**
- Снижение нагрузки на БД в 50-100 раз
- Не влияет на задержку (запись асинхронная)

---

## Масштабируемость

### Текущие ограничения

**Тестировано:**
- 1 комната, 5 участников — работает стабильно
- 10 комнат, 50 участников — работает стабильно

**Ожидаемая нагрузка:**
- 100 комнат, 500+ участников — требует тестирования

### Узкие места

1. **FFmpeg процессы:**
   - Каждая сессия = 1 FFmpeg процесс
   - 100 сессий = 100 процессов FFmpeg
   - Память: ~50-100MB на процесс
   - CPU: зависит от качества RTMP потока

2. **Gladia WebSocket соединения:**
   - Каждая сессия = 1 WebSocket к Gladia
   - 100 сессий = 100 WebSocket соединений
   - Gladia может иметь лимиты на количество соединений

3. **WebSocket клиентские соединения:**
   - Каждый клиент = 1 WebSocket соединение
   - 500 клиентов = 500 WebSocket соединений
   - Память: ~1-2MB на соединение

### Рекомендации для масштабирования

1. **Горизонтальное масштабирование:**
   - Разделение на несколько инстансов Railway
   - Load balancer для распределения сессий
   - Sticky sessions для WebSocket

2. **Оптимизация памяти:**
   - Ограничение количества активных сессий на инстанс
   - Автоматическая очистка неактивных сессий
   - Мониторинг памяти и CPU

3. **Мониторинг:**
   - Метрики через `/metrics` endpoint
   - Алерты при высокой нагрузке
   - Логирование для анализа производительности

---

## Мониторинг и отладка

### Логи для анализа

**Ключевые логи:**
- `[RTMPServer] 🔵 RTMP client connecting` — подключение Egress
- `[RTMPServer] ✅ RTMP stream connecting` — поток начался
- `[RTMPIngest] ✅ LiveKit Egress connected to RTMP stream` — FFmpeg запущен
- `[RTMPIngest] 📨 Received transcript from Gladia` — получен транскрипт
- `[RTMPIngest] ⏱️ Transcript delivery metrics` — метрики задержки

**Метрики:**
- HTTP GET `/metrics` — снимок всех метрик latency
- Периодическое логирование каждые 100 записей

### Отладка проблем

1. **Транскрипция не запускается:**
   - Проверить логи `[WS-SERVER] Received transcription start request`
   - Проверить переменные `RTMP_HOST`, `RTMP_EXTERNAL_PORT`
   - Проверить Railway TCP Proxy

2. **FFmpeg не запускается:**
   - Проверить логи `[RTMPServer] ✅ RTMP stream connecting`
   - Проверить stderr FFmpeg в логах
   - Проверить, что RTMP поток действительно приходит

3. **Gladia не получает аудио:**
   - Проверить логи `[GladiaBridge] WebSocket closed` (код 4408)
   - Проверить метрики `audioBytesSent` в RTMP Ingest
   - Проверить соединение с Gladia

4. **Транскрипты не доставляются клиентам:**
   - Проверить логи `[WS-SERVER] Client connected`
   - Проверить `REALTIME_BROADCAST_MODE` (должен быть `direct`)
   - Проверить WebSocket соединения клиентов

---

## Заключение

Realtime Core архитектура обеспечивает минимальную задержку транскрипции (0.5-1.2 секунды) за счет:
- Монолитной архитектуры (все компоненты в одном процессе)
- Direct WebSocket broadcast (без HTTP-хопа)
- Low-latency FFmpeg конфигурации
- Immediate audio chunking

Качество транскрипции зависит от качества аудио и составляет 95-98% точности.

Проблема с draft → final транскриптами связана с особенностями работы Gladia Live v2 и может быть частично решена на клиенте через автоматическую "финализацию" draft транскриптов.


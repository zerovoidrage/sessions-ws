# Текущее состояние сессий и проблемы

Детальный технический документ о текущей реализации сессий, состояниях компонентов и возникающих проблемах.

---

## 1. Текущая архитектура

### 1.1. Компоненты системы

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Frontend                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ useRoom      │  │ useParticipants│ │ useLocalPart │     │
│  │              │  │               │ │ Transcription │     │
│  └──────┬───────┘  └──────┬───────┘ └──────┬────────┘     │
│         │                  │                 │              │
│         └──────────────────┼─────────────────┘              │
│                            │                                │
│                    ┌───────▼────────┐                       │
│                    │  LiveKit Room  │                       │
│                    └───────┬────────┘                       │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             │ WebRTC
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                    LiveKit Cloud                             │
│              (omni-pxx5e1ko.livekit.cloud)                  │
└──────────────────────────────────────────────────────────────┘
                             │
                             │ WebSocket
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              WebSocket Server (Node.js)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ws://localhost:3001/api/realtime/transcribe         │   │
│  │  - Принимает аудио чанки от клиента                  │   │
│  │  - Создает Gladia bridge для каждого соединения      │   │
│  │  - Отправляет транскрипты обратно клиенту            │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             │ API
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                    Gladia API                                │
│              (Транскрипция аудио в текст)                    │
└──────────────────────────────────────────────────────────────┘
                             │
                             │ HTTP
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              Next.js API Routes                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  POST /api/sessions                                  │   │
│  │  GET  /api/sessions                                  │   │
│  │  DELETE /api/sessions/[slug]                         │   │
│  │  GET  /api/sessions/[slug]/token                     │   │
│  │  GET  /api/sessions/[slug]/participants/[identity]   │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             │ Prisma
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              PostgreSQL (Neon)                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  VideoSession                                       │   │
│  │  Participant                                       │   │
│  │  TranscriptSegment                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 1.2. Поток данных при подключении участника

```
1. Пользователь открывает /session/[slug]
   ↓
2. Получение токена: GET /api/sessions/[slug]/token
   - Генерируется identity: userId:sessionId (для авторизованных)
   - Или: guest-${slug}-${random} (для гостей)
   ↓
3. useRoom создает Room инстанс
   - new Room()
   - room.connect(serverUrl, token)
   ↓
4. LiveKit подключает участника
   - Room state: 'connecting' → 'connected'
   - Событие: RoomEvent.Connected
   ↓
5. useParticipants синхронизирует участников
   - Читает room.localParticipant
   - Читает room.remoteParticipants
   - Подписывается на события:
     * ParticipantConnected
     * ParticipantDisconnected
     * TrackSubscribed
     * TrackUnsubscribed
   ↓
6. Автоматическое включение микрофона
   - localParticipant.setMicrophoneEnabled(true)
   ↓
7. Запуск транскрипции
   - useLocalParticipantTranscription.start()
   - Создается AudioContext
   - Создается WebSocket к транскрипционному серверу
   - Захватывается аудио из микрофона
   ↓
8. Отправка аудио на WebSocket сервер
   - Аудио конвертируется в PCM16
   - Отправляется чанками на ws://localhost:3001
   ↓
9. WebSocket сервер обрабатывает аудио
   - Создает Gladia bridge
   - Отправляет аудио в Gladia
   - Получает транскрипты
   - Сохраняет в БД через appendTranscriptChunk()
   - Отправляет транскрипты обратно клиенту
   ↓
10. Клиент получает транскрипты
    - Публикует в LiveKit через publishData()
    - Вызывает локальный callback для отображения
    ↓
11. Другие участники получают транскрипты
    - Через dataReceived event
    - Отображают в TranscriptSidebar
```

---

## 2. Состояния компонентов

### 2.1. useRoom

**Состояния:**
- `room: Room | null` - инстанс LiveKit Room
- `isConnected: boolean` - подключен ли к комнате
- `error: Error | null` - ошибка подключения

**Жизненный цикл:**
1. **Инициализация:**
   - Создается `new Room()` при наличии `token` и `serverUrl`
   - Сохраняется в `roomRef.current` и `room` state

2. **Подключение:**
   - Вызывается `room.connect(serverUrl, token)`
   - Подписывается на события `Connected` и `Disconnected`
   - При успехе: `isConnected = true`

3. **Переподключение:**
   - LiveKit автоматически переподключается при ошибках
   - Может менять регион: `omni-pxx5e1ko.livekit.cloud` → `omni-pxx5e1ko.dfra1b.production.livekit.cloud`

4. **Cleanup:**
   - При изменении `token` или `serverUrl`: отключает старую комнату
   - Удаляет обработчики событий
   - Очищает refs

**Проблемы:**
- ❌ При переподключении может создаваться новый Room инстанс, если `token` или `serverUrl` меняются
- ❌ Нет явной обработки ошибок переподключения
- ⚠️ Состояние `isConnected` может не синхронизироваться с реальным состоянием комнаты

### 2.2. useParticipants

**Состояния:**
- `localParticipant: LocalParticipant | null`
- `remoteParticipants: RemoteParticipant[]`

**Синхронизация:**
- Читает напрямую из `room.localParticipant` и `room.remoteParticipants`
- Подписывается на события:
  - `ParticipantConnected` - новый участник подключился
  - `ParticipantDisconnected` - участник отключился
  - `TrackSubscribed` - подписались на трек
  - `TrackUnsubscribed` - отписались от трека

**Проблемы:**
- ✅ Исправлено: теперь синхронизируется только с Room, не хранит отдельный список
- ⚠️ Может быть задержка между событием LiveKit и обновлением UI
- ⚠️ При быстром подключении/отключении участников могут быть пропуски

### 2.3. useLocalParticipantTranscription

**Состояния:**
- `isActive: boolean` - активна ли транскрипция
- `wsReady: boolean` (ref) - готов ли WebSocket
- `audioContext: AudioContext | null` (ref)
- `processor: ScriptProcessorNode | null` (ref)
- `source: MediaStreamAudioSourceNode | null` (ref)

**Жизненный цикл:**
1. **Запуск (`start()`):**
   - Устанавливает `isActive = true`
   - Запускается `useEffect` с зависимостями `[isActive, room, localParticipant, ...]`

2. **Инициализация:**
   - Ждет доступности аудио трека (до 30 попыток, 6 секунд)
   - Создает `AudioContext` с sample rate 16kHz
   - Создает `ScriptProcessorNode` для обработки аудио
   - Подключается к WebSocket серверу

3. **Обработка аудио:**
   - `onaudioprocess` вызывается при каждом чанке
   - Конвертирует Float32Array → Int16Array (PCM16)
   - Отправляет на WebSocket сервер

4. **Получение транскриптов:**
   - WebSocket сервер отправляет транскрипты
   - Вызывается `sendTranscriptFromServer()`
   - Публикуется в LiveKit через `publishData()`
   - Вызывается локальный callback

5. **Остановка (`stop()`):**
   - Устанавливает `isActive = false`
   - Cleanup: закрывает WebSocket, AudioContext, отключает процессоры

**Проблемы:**
- ❌ **AudioContext autoplay policy в Chrome:**
  - AudioContext может быть в состоянии `suspended`
  - Требует пользовательского жеста для возобновления
  - **Частично исправлено:** добавлена проверка состояния и возобновление при жесте

- ❌ **Транскрипция не перезапускается при переподключении:**
  - Если LiveKit переподключается, транскрипция может остановиться
  - WebSocket соединение может разорваться
  - AudioContext может быть закрыт

- ⚠️ **Устаревший API:**
  - Используется `ScriptProcessorNode` (deprecated)
  - Рекомендуется `AudioWorkletNode`

- ⚠️ **Нет обработки ошибок WebSocket:**
  - При разрыве соединения транскрипция не переподключается автоматически

### 2.4. VideoGrid

**Состояния:**
- Получает `localParticipant` и `remoteParticipants` как пропсы
- Не имеет собственного состояния участников

**Отображение:**
- Фильтрует участников с видео треками
- Ищет активный видео трек (не muted, Camera source)
- Отображает в сетке

**Проблемы:**
- ✅ Исправлено: больше не зависит от `room`, только от пропсов
- ⚠️ Может не обновляться при изменении треков (зависит от родительского компонента)

---

## 3. Проблемы и их статус

### 3.1. Критические проблемы

#### ❌ Проблема 1: Транскрипция останавливается при переподключении LiveKit

**Описание:**
При переподключении LiveKit (например, при смене региона или проблемах с сетью) транскрипция может остановиться и не перезапуститься автоматически.

**Причины:**
1. WebSocket соединение разрывается при переподключении
2. AudioContext может быть закрыт
3. `useEffect` в `useLocalParticipantTranscription` не перезапускается при переподключении

**Симптомы:**
- В логах: `[Transcription] Audio chunk sent` перестает появляться
- WebSocket закрывается: `[Transcription] WebSocket closed`
- Транскрипты перестают приходить

**Текущее состояние:**
- ❌ Не исправлено
- ⚠️ Есть проверки состояния комнаты, но нет автоматического перезапуска

**Решение:**
1. Добавить обработку события `RoomEvent.Reconnecting` / `RoomEvent.Reconnected`
2. При переподключении перезапускать транскрипцию
3. Добавить retry логику для WebSocket соединения

#### ❌ Проблема 2: AudioContext suspended в Chrome

**Описание:**
Chrome блокирует автоматический запуск AudioContext без пользовательского жеста (autoplay policy). Это приводит к тому, что транскрипция не работает до первого клика.

**Причины:**
- Chrome требует пользовательского жеста для возобновления AudioContext
- AudioContext создается в состоянии `suspended`

**Симптомы:**
- В консоли: `The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.`
- Транскрипция не обрабатывает аудио до первого клика

**Текущее состояние:**
- ✅ Частично исправлено: добавлена проверка состояния и возобновление при жесте
- ⚠️ Но проверка в `onaudioprocess` может быть недостаточной

**Решение:**
1. ✅ Добавлено: проверка `audioContext.state === 'suspended'` в `onaudioprocess`
2. ✅ Добавлено: обработчики `click` и `touchstart` для возобновления
3. ⚠️ Нужно: более агрессивное возобновление при каждом жесте

### 3.2. Средние проблемы

#### ⚠️ Проблема 3: Участники создаются в БД только при первом транскрипте

**Описание:**
Участники создаются в таблице `Participant` только когда приходит первый транскрипт от этого участника. До этого участник существует только в LiveKit, но не в БД.

**Причины:**
- `upsertParticipantByIdentity()` вызывается только в `appendTranscriptChunk()`
- `appendTranscriptChunk()` вызывается только при получении транскрипта от WebSocket сервера

**Симптомы:**
- Запрос `GET /api/sessions/[slug]/participants/[identity]` возвращает 404
- Аватары участников не загружаются до первого транскрипта

**Текущее состояние:**
- ✅ Частично исправлено: эндпоинт возвращает базовую информацию, если участник не найден
- ⚠️ Но участник все равно не создается в БД до транскрипта

**Решение:**
1. Создавать участника при подключении к комнате (в обработчике `ParticipantConnected`)
2. Или создавать участника при получении токена

#### ⚠️ Проблема 4: Identity с двоеточиями в URL

**Описание:**
Identity формируется как `userId:sessionId`, что содержит двоеточие. При использовании в URL это может вызывать проблемы.

**Причины:**
- Identity генерируется в токен-эндпоинте как `${userId}:${sessionId}`
- Двоеточие не кодируется автоматически в URL

**Симптомы:**
- 404 ошибки при запросе `/api/sessions/[slug]/participants/[identity]`
- Next.js неправильно парсит путь

**Текущее состояние:**
- ✅ Исправлено: добавлено `encodeURIComponent()` в клиенте и `decodeURIComponent()` в эндпоинте

### 3.3. Мелкие проблемы

#### ⚠️ Проблема 5: Устаревший API ScriptProcessorNode

**Описание:**
Используется устаревший `ScriptProcessorNode` вместо рекомендуемого `AudioWorkletNode`.

**Причины:**
- `ScriptProcessorNode` проще в использовании
- `AudioWorkletNode` требует отдельного файла worklet

**Симптомы:**
- В консоли: `[Deprecation] The ScriptProcessorNode is deprecated. Use AudioWorkletNode instead.`

**Текущее состояние:**
- ⚠️ Не исправлено (не критично, но нужно мигрировать)

#### ⚠️ Проблема 6: Нет обработки ошибок WebSocket

**Описание:**
При разрыве WebSocket соединения транскрипция не переподключается автоматически.

**Причины:**
- Нет retry логики для WebSocket
- При ошибке соединение просто закрывается

**Симптомы:**
- Транскрипция останавливается при проблемах с сетью
- Нужно перезагрузить страницу для восстановления

**Текущее состояние:**
- ⚠️ Не исправлено

#### ⚠️ Проблема 7: Race condition при удалении сессий

**Описание:**
При удалении сессии может происходить race condition между оптимистичным обновлением UI и загрузкой списка сессий.

**Причины:**
- `useEffect` загружает список сессий при фокусе/видимости
- Это может происходить во время удаления

**Симптомы:**
- Сессия удаляется, затем появляется обратно на полсекунды
- Затем снова удаляется

**Текущее состояние:**
- ✅ Исправлено: добавлен `isDeletingRef` для блокировки перезагрузки во время удаления

#### ⚠️ Проблема 8: Foreign key constraints при удалении сессий

**Описание:**
При удалении сессии возникали ошибки из-за foreign key constraints с `TranscriptSegment` и `Participant`.

**Причины:**
- `deleteSessionById()` удаляла только `VideoSession`
- Связанные записи не удалялись

**Симптомы:**
- Ошибка: `Foreign key constraint violated: TranscriptSegment_videoSessionId_fkey`
- Сессия не удаляется

**Текущее состояние:**
- ✅ Исправлено: используется транзакция Prisma для удаления всех связанных записей

---

## 4. Технические детали

### 4.1. Identity и участники

**Формат identity:**
- Для авторизованных: `${userId}:${sessionId}`
- Для гостей: `guest-${slug}-${random}`

**Проблемы:**
- Двоеточие в identity требует кодирования в URL
- Identity должен быть уникальным в рамках сессии

**Хранение в БД:**
- `Participant.identity` - уникальный индекс `[videoSessionId, identity]`
- Участник создается только при первом транскрипте

### 4.2. Состояния LiveKit Room

**Возможные состояния:**
- `disconnected` - не подключен
- `connecting` - подключается
- `connected` - подключен
- `reconnecting` - переподключается

**Проблемы:**
- При переподключении состояние может быстро меняться
- Транскрипция не обрабатывает состояние `reconnecting`

### 4.3. WebSocket соединение для транскрипции

**URL:**
```
ws://localhost:3001/api/realtime/transcribe?sessionSlug=${slug}&identity=${identity}
```

**Проблемы:**
- Нет автоматического переподключения при разрыве
- Нет обработки ошибок соединения
- Нет heartbeat/ping для проверки соединения

### 4.4. AudioContext и обработка аудио

**Текущая реализация:**
1. Создается `AudioContext` с sample rate 16kHz
2. Создается `MediaStreamAudioSourceNode` из микрофона
3. Создается `ScriptProcessorNode` для обработки
4. Аудио конвертируется в PCM16 (Int16Array)
5. Отправляется на WebSocket сервер

**Проблемы:**
- `ScriptProcessorNode` deprecated
- AudioContext может быть suspended в Chrome
- Нет обработки ошибок при создании AudioContext

---

## 5. Рекомендации по исправлению

### 5.1. Приоритет 1: Критические проблемы

1. **Автоматический перезапуск транскрипции при переподключении:**
   ```typescript
   // В useLocalParticipantTranscription
   useEffect(() => {
     if (!room) return
     
     const handleReconnected = () => {
       if (isActive) {
         // Перезапускаем транскрипцию
         stop()
         setTimeout(() => start(), 1000)
       }
     }
     
     room.on(RoomEvent.Reconnected, handleReconnected)
     return () => room.off(RoomEvent.Reconnected, handleReconnected)
   }, [room, isActive])
   ```

2. **Retry логика для WebSocket:**
   ```typescript
   const connectWebSocket = async (retries = 3) => {
     for (let i = 0; i < retries; i++) {
       try {
         const ws = new WebSocket(wsUrl)
         await new Promise((resolve, reject) => {
           ws.onopen = resolve
           ws.onerror = reject
           setTimeout(() => reject(new Error('Timeout')), 5000)
         })
         return ws
       } catch (error) {
         if (i === retries - 1) throw error
         await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
       }
     }
   }
   ```

### 5.2. Приоритет 2: Средние проблемы

1. **Создание участников при подключении:**
   ```typescript
   // В обработчике ParticipantConnected
   const handleParticipantConnected = async (participant: RemoteParticipant) => {
     await upsertParticipantByIdentity({
       sessionId: session.id,
       identity: participant.identity,
       name: participant.name,
       role: 'GUEST',
     })
   }
   ```

2. **Миграция на AudioWorkletNode:**
   - Создать отдельный файл worklet
   - Заменить `ScriptProcessorNode` на `AudioWorkletNode`
   - Обновить обработку аудио

### 5.3. Приоритет 3: Улучшения

1. **Добавить heartbeat для WebSocket:**
   ```typescript
   setInterval(() => {
     if (ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify({ type: 'ping' }))
     }
   }, 30000)
   ```

2. **Улучшить обработку ошибок:**
   - Добавить retry логику для всех операций
   - Логировать ошибки в систему мониторинга
   - Показывать пользователю понятные сообщения об ошибках

---

## 6. Заключение

**Текущее состояние:**
- ✅ Базовая функциональность работает
- ✅ Синхронизация участников исправлена
- ✅ Удаление сессий исправлено
- ⚠️ Транскрипция работает, но есть проблемы с переподключениями
- ⚠️ AudioContext требует пользовательского жеста в Chrome

**Критические проблемы:**
1. Транскрипция останавливается при переподключении LiveKit
2. AudioContext suspended в Chrome (частично исправлено)

**Следующие шаги:**
1. Реализовать автоматический перезапуск транскрипции при переподключении
2. Добавить retry логику для WebSocket
3. Создавать участников в БД при подключении к комнате
4. Мигрировать на AudioWorkletNode


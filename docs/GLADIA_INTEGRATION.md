# Техническая интеграция Gladia для Live транскрипции

## Обзор

Проект использует [Gladia API](https://docs.gladia.io/) для real-time транскрипции речи в видео-звонках. Интеграция состоит из трех основных компонентов:

1. **WebSocket сервер** (`server-websocket.js`) - прокси между клиентом и Gladia API
2. **Клиентский хук** (`useLocalParticipantTranscription.ts`) - захват аудио и отправка на сервер
3. **Хук обработки транскриптов** (`useTranscriptStream.ts`) - обработка и группировка сообщений

---

## Архитектура

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Browser       │         │  WebSocket       │         │   Gladia     │
│   (Client)      │◄───────►│  Server          │◄───────►│   API        │
│                 │         │  (Node.js)       │         │              │
└─────────────────┘         └──────────────────┘         └──────────────┘
      │                              │
      │ Audio Stream                 │ Transcription Messages
      │ (PCM16, 16kHz)               │ (JSON)
      │                              │
      ▼                              ▼
┌─────────────────┐         ┌──────────────────┐
│ LiveKit Room    │         │  Client UI       │
│ (Data Channel)  │         │  (Transcript)    │
└─────────────────┘         └──────────────────┘
```

---

## 1. WebSocket сервер (`server-websocket.js`)

### Инициализация сессии Gladia

Сервер инициирует сессию через POST запрос к Gladia API:

```javascript
POST https://api.gladia.io/v2/live
Headers:
  x-gladia-key: <API_KEY>
  Content-Type: application/json
Body:
{
  "encoding": "wav/pcm",
  "sample_rate": 16000,
  "bit_depth": 16,
  "channels": 1,
  "messages_config": {
    "receive_partial_transcripts": true  // Включаем драфты для real-time
  }
}
```

**Ответ:**
```json
{
  "session_id": "xxx",
  "url": "wss://api.gladia.io/v2/live?token=xxx"
}
```

### Обработка аудио потока

1. Клиент отправляет аудио чанки (PCM16, 16kHz) через WebSocket
2. Сервер пересылает их напрямую в Gladia WebSocket как бинарные данные
3. Gladia обрабатывает аудио и возвращает транскрипты

### Обработка транскриптов от Gladia

Gladia отправляет сообщения в формате:

```json
{
  "type": "transcript",
  "data": {
    "id": "00-00000011",           // utteranceId - ID сегмента речи
    "is_final": false,              // false = драфт, true = финальный
    "utterance": {
      "text": "Hello world."
    }
  }
}
```

**Сервер извлекает:**
- `text` - текст транскрипта
- `is_final` - статус (драфт/финальный)
- `id` - utteranceId для группировки сегментов

**Отправка клиенту:**
```javascript
{
  type: 'transcription',
  text: 'Hello world.',
  is_final: false,
  utterance_id: '00-00000011'
}
```

---

## 2. Клиентский хук (`useLocalParticipantTranscription.ts`)

### Захват аудио

1. Получает аудио трек от LiveKit (`localParticipant.getTrackPublication('microphone')`)
2. Создает `AudioContext` с sample rate 16kHz
3. Использует `ScriptProcessorNode` для обработки аудио
4. Конвертирует в PCM16 формат (`Int16Array`)
5. Отправляет чанки на WebSocket сервер

### Получение транскриптов

1. Получает сообщения от WebSocket сервера
2. Вызывает `sendTranscriptFromServer()` который:
   - Публикует транскрипт в LiveKit Room через `publishData()`
   - Вызывает `onTranscriptCallbackRef.current()` для локального отображения

---

## 3. Обработка транскриптов (`useTranscriptStream.ts`)

### Группировка сообщений

Хук получает транскрипты из двух источников:
- **Локальный участник**: через `onTranscriptCallbackRef` (callback)
- **Удаленные участники**: через LiveKit `dataReceived` event

### Логика склеивания фрагментов

**Проблема:** Gladia может отправлять несколько фрагментов одного высказывания как отдельные сообщения, даже без паузы. Это приводит к разбиению одной фразы на несколько сообщений.

**Решение:** Склеивание фрагментов в одно сообщение, если пауза между ними меньше 2 секунд.

#### Алгоритм группировки (приоритет):

1. **По `utteranceId` (приоритетная логика Gladia)**
   - Если у сообщения есть `utteranceId`, ищем существующее сообщение с таким же `speakerId` + `utteranceId`
   - Это правильная группировка по сегментам от Gladia
   - Обновляем текст существующего сообщения

2. **По паузе (fallback для склеивания фрагментов)**
   - Если `utteranceId` нет или совпадения не найдено
   - Ищем последнее сообщение от того же спикера
   - Вычисляем паузу: `pauseMs = now - lastMessage.timestamp`
   - Если `pauseMs < 2000ms` (2 секунды) → склеиваем с последним сообщением
   - Если `pauseMs >= 2000ms` → создаем новое сообщение

#### Умное склеивание текста

Gladia может отправлять:
- **Полный текст сегмента** (все слова)
- **Только новую часть** (продолжение предыдущего)

**Логика склеивания:**

```typescript
// 1. Если новый текст содержит старый полностью
if (newText.includes(existingText)) {
  // Это полный текст от Gladia - заменяем
  mergedText = newText
}
// 2. Если новый текст начинается с конца старого
else if (existingText.endsWith(newText.substring(0, 20))) {
  // Это продолжение - склеиваем
  mergedText = existingText + ' ' + newText
}
// 3. Если новый текст длиннее и не содержит старый
else if (newText.length > existingText.length && !existingText.includes(newText)) {
  // Вероятно полный текст - заменяем
  mergedText = newText
}
// 4. Иначе берем более длинный вариант
else {
  mergedText = newText.length > existingText.length ? newText : existingText
}
```

**Примеры:**

1. **Полный текст:**
   - Было: "Hello"
   - Пришло: "Hello world"
   - Результат: "Hello world" (замена)

2. **Продолжение:**
   - Было: "Hello"
   - Пришло: "world"
   - Результат: "Hello world" (склеивание)

3. **Новый сегмент (пауза >= 2 сек):**
   - Было: "Hello world" (timestamp: 1000)
   - Пришло: "How are you" (timestamp: 3000)
   - Результат: новое сообщение (пауза 2 сек)

### Дедупликация

Если текст и статус (`isFinal`) не изменились, сообщение не обновляется (избегаем лишних ре-рендеров).

---

## Параметры конфигурации

### Аудио параметры
- **Sample Rate**: 16000 Hz
- **Bit Depth**: 16 bit
- **Channels**: 1 (моно)
- **Format**: PCM16 (WAV)

### Таймауты
- **PAUSE_THRESHOLD**: 2000ms (2 секунды) - порог для создания нового сообщения

### Gladia API
- **Endpoint**: `https://api.gladia.io/v2/live`
- **WebSocket URL**: `wss://api.gladia.io/v2/live?token=<token>`
- **Partial transcripts**: включены (`receive_partial_transcripts: true`)

---

## Поток данных

### 1. Захват аудио
```
Microphone → AudioContext → ScriptProcessorNode → PCM16 → WebSocket Server
```

### 2. Транскрипция
```
WebSocket Server → Gladia API → Transcription Messages
```

### 3. Обработка транскриптов
```
Gladia API → WebSocket Server → Client → useTranscriptStream → UI
```

### 4. Синхронизация между участниками
```
Local Participant → LiveKit publishData() → Remote Participants → dataReceived
```

---

## Особенности реализации

### Обработка драфтов и финальных сообщений

- **Драфты** (`is_final: false`): обновляют существующее сообщение, показываются с `opacity: 40%`
- **Финальные** (`is_final: true`): финализируют сообщение, показываются с `opacity: 100%`

### Игнорирование локальных эхо

Локальный участник получает транскрипты:
1. Через `onTranscriptCallbackRef` (прямой callback)
2. Через `dataReceived` (эхо от LiveKit)

Чтобы избежать дублей, `handleData` игнорирует сообщения от локального участника:

```typescript
if (local && participant && participant.identity === local.identity) {
  return // Пропускаем локальное эхо
}
```

### Автоскролл к новым сообщениям

При появлении нового сообщения сайдбар автоматически прокручивается вниз:

```typescript
useEffect(() => {
  if (scrollContainerRef.current && visibleMessages.length > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      })
    })
  }
}, [visibleMessages])
```

---

## Проблемы и решения

### Проблема: Фрагменты разбиваются на несколько сообщений

**Причина:** Gladia отправляет несколько `Results` для одного высказывания, даже без паузы.

**Решение:** Склеивание по паузе (< 2 сек) + группировка по `utteranceId`.

### Проблема: Потеря слов при склеивании

**Причина:** Gladia может отправлять только новую часть текста, а не полный текст.

**Решение:** Умная логика склеивания, которая определяет, является ли новый текст продолжением или полным текстом.

### Проблема: Дублирование локальных сообщений

**Причина:** Локальный участник получает транскрипты и через callback, и через `dataReceived`.

**Решение:** Игнорирование `dataReceived` для локального участника.

---

## Будущие улучшения

1. **Настройка порога паузы**: сделать `PAUSE_THRESHOLD` конфигурируемым
2. **Улучшение склеивания**: более точное определение продолжения текста (NLP анализ)
3. **Обработка ошибок**: retry логика для WebSocket соединений
4. **Метрики**: отслеживание latency и качества транскрипции

---

## Ссылки

- [Gladia API Documentation](https://docs.gladia.io/)
- [Gladia Live STT Quickstart](https://docs.gladia.io/chapters/live-stt/quickstart)
- [Gladia Partial Transcripts](https://docs.gladia.io/chapters/live-stt/features/partial-transcripts)


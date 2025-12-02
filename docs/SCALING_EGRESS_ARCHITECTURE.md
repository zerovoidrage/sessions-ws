# Архитектура масштабирования серверной транскрипции

## Проблема масштабирования

**Текущая ситуация:**
- LiveKit Cloud лимит: **2 одновременных Egress сессии**
- При использовании Track Egress: **1 сессия на трек**
- При 5 участниках в одной комнате = **5 сессий** (превышение лимита в 2.5 раза)
- При 500 человек в разных звонках = **500+ сессий** (невозможно!)

**Вывод:** Track Egress **не масштабируется** для нашей задачи.

## Решения для масштабирования

### Вариант 1: Room Composite Egress с audioOnly (1 сессия на комнату) ⭐ РЕКОМЕНДУЕТСЯ

**Преимущества:**
- ✅ **1 Egress сессия на комнату** (независимо от количества участников)
- ✅ **Микширование на стороне Egress** (не нужно на сервере)
- ✅ При 500 человек в 100 комнатах = **100 сессий** (всё ещё много, но лучше)
- ✅ Автоматическое микширование всех участников

**Проблемы:**
- ⚠️ Room Composite не поддерживает **прямой WebSocket выход**
- ⚠️ Поддерживает только **RTMP** или **файловый вывод**
- ⚠️ Не real-time (задержка 100-500ms)

**Решение:**
Использовать **RTMP поток** от Room Composite и декодировать его на сервере:

```typescript
// 1. Запускаем Room Composite Egress с audioOnly и RTMP выходом
await egressClient.startRoomCompositeEgress(
  roomName,
  {
    stream: {
      protocol: StreamProtocol.RTMP,
      urls: [`rtmp://your-rtmp-server/live/${roomName}`],
    },
  },
  { audioOnly: true }
)

// 2. Подключаемся к RTMP серверу и декодируем поток
// 3. Отправляем в Gladia
```

**Требования:**
- RTMP сервер (nginx-rtmp, SRS, или облачный)
- Декодирование RTMP → PCM16

**Масштабирование:**
- 500 человек в 100 комнатах = **100 Egress сессий**
- Нужен upgrade плана до **100+ одновременных сессий**

### Вариант 2: Гибридный подход (Egress + Fallback) ⭐⭐ ИДЕАЛЬНО

**Идея:**
- Использовать **Room Composite Egress** для комнат с несколькими участниками (1 сессия на комнату)
- Использовать **fallback через livekit-client** для комнат с 1 участником или при превышении лимитов

**Архитектура:**
```
Если участников > 1:
  → Room Composite Egress (1 сессия на комнату)
  
Если участников = 1:
  → Fallback через livekit-client (без Egress)
  
Если Egress лимит превышен:
  → Fallback через livekit-client (без Egress)
```

**Преимущества:**
- ✅ Оптимальное использование лимитов Egress
- ✅ Масштабируется до любого количества участников
- ✅ Graceful degradation при превышении лимитов

**Реализация:**
```typescript
async startTranscription(sessionId: string, roomName: string) {
  const participantCount = await getParticipantCount(roomName)
  
  if (participantCount > 1 && canUseEgress()) {
    // Используем Room Composite Egress
    await startRoomCompositeEgress(roomName)
  } else {
    // Используем fallback через livekit-client
    await startClientBasedTranscription(roomName)
  }
}
```

### Вариант 3: Полностью отказаться от Egress (WebRTC полифиллы)

**Идея:**
- Использовать `livekit-client` с WebRTC полифиллами (`wrtc` или `node-webrtc`)
- Подключаться к комнате как участник
- Получать треки напрямую через WebRTC

**Преимущества:**
- ✅ **Нет лимитов Egress** (не используем Egress вообще)
- ✅ **Real-time** (низкая задержка)
- ✅ Полный контроль над треками

**Недостатки:**
- ⚠️ Требует нативных зависимостей (могут быть проблемы с компиляцией)
- ⚠️ Выше нагрузка на сервер (обработка WebRTC)
- ⚠️ Сложнее в настройке и поддержке

**Реализация:**
```typescript
// Используем существующий код из livekit-transcriber.ts
// Но с реальным захватом аудио через WebRTC полифиллы
import 'wrtc' // или 'node-webrtc'

const room = new Room()
await room.connect(wsUrl, token)

// Получаем треки напрямую
room.on(RoomEvent.TrackSubscribed, (track) => {
  // Захватываем аудио из track
  // Отправляем в Gladia
})
```

### Вариант 4: Использовать LiveKit Ingress для обратного потока

**Идея:**
- Создать отдельный сервис, который подключается к комнате как участник
- Использует LiveKit Ingress для получения микшированного аудио
- Обрабатывает и отправляет в Gladia

**Преимущества:**
- ✅ Использует стандартные LiveKit API
- ✅ Масштабируется лучше, чем Egress

**Недостатки:**
- ⚠️ Ingress предназначен для входящих потоков, не для получения аудио из комнаты
- ⚠️ Может не подойти для нашей задачи

## Рекомендуемая архитектура (Гибридный подход)

### Уровень 1: Room Composite Egress (приоритет)

**Когда использовать:**
- Комната с **2+ участниками**
- Egress лимит не превышен
- Нужно микширование всех участников

**Реализация:**
```typescript
// 1. Запускаем Room Composite Egress с RTMP
const egressInfo = await egressClient.startRoomCompositeEgress(
  roomName,
  {
    stream: {
      protocol: StreamProtocol.RTMP,
      urls: [`rtmp://rtmp-server/live/${roomName}`],
    },
  },
  { audioOnly: true }
)

// 2. Подключаемся к RTMP и декодируем
const rtmpStream = await connectToRTMP(`rtmp://rtmp-server/live/${roomName}`)
rtmpStream.on('audio', (pcmData) => {
  gladiaBridge.sendAudio(pcmData)
})
```

### Уровень 2: Fallback через livekit-client

**Когда использовать:**
- Комната с **1 участником**
- Egress лимит превышен
- Room Composite Egress недоступен

**Реализация:**
```typescript
// Используем существующий код из livekit-transcriber.ts
// Подключаемся к комнате как участник
// Получаем треки и отправляем в Gladia
```

### Уровень 3: Мониторинг и автоматическое переключение

**Реализация:**
```typescript
class TranscriptionManager {
  private egressUsage = 0
  private readonly egressLimit = 2 // или из настроек
  
  async startTranscription(sessionId: string, roomName: string) {
    const participantCount = await this.getParticipantCount(roomName)
    
    // Решение 1: Room Composite Egress (если доступен и участников > 1)
    if (participantCount > 1 && this.egressUsage < this.egressLimit) {
      try {
        await this.startRoomCompositeEgress(roomName)
        this.egressUsage++
        return
      } catch (error) {
        console.warn('Egress failed, falling back:', error)
      }
    }
    
    // Решение 2: Fallback через livekit-client
    await this.startClientBasedTranscription(roomName)
  }
  
  async stopTranscription(sessionId: string) {
    // Освобождаем Egress сессию
    this.egressUsage--
  }
}
```

## Что даст декодирование Opus

### Текущая ситуация

**Проблема:**
- Track Egress отправляет аудио в формате трека (обычно **Opus**)
- Gladia требует **PCM16 16kHz моно**
- Без декодирования Gladia **не сможет обработать** аудио

**Результат:**
- ❌ Транскрипция не работает
- ❌ Ошибки в Gladia API
- ❌ Потраченные ресурсы впустую

### После декодирования

**Преимущества:**
- ✅ Gladia получает правильный формат (PCM16 16kHz)
- ✅ Транскрипция работает корректно
- ✅ Можно использовать Track Egress для real-time транскрипции

**Реализация:**
```typescript
import { OpusEncoder } from '@discordjs/opus'

class AudioDecoder {
  private decoder = new OpusEncoder(16000, 1) // 16kHz, mono
  
  decodeOpusToPCM16(opusBuffer: Buffer): Buffer {
    return this.decoder.decode(opusBuffer)
  }
}

// В обработчике Egress данных
private handleEgressAudioData(trackId: string, data: WebSocket.Data) {
  const opusBuffer = Buffer.from(data)
  const pcmBuffer = this.audioDecoder.decodeOpusToPCM16(opusBuffer)
  this.audioBuffers.get(trackId)!.push(pcmBuffer)
}
```

**Важно:**
- Декодирование нужно **только для Track Egress**
- Room Composite Egress с RTMP уже даёт декодированный поток
- Fallback через livekit-client может работать напрямую с PCM

## Идеальная архитектура для 500+ пользователей

### Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    Transcription Service                     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Transcription Router (Smart Routing)         │  │
│  │                                                         │  │
│  │  • Определяет оптимальный метод транскрипции          │  │
│  │  • Учитывает лимиты Egress                             │  │
│  │  • Мониторит использование ресурсов                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│        ┌─────────────────┴─────────────────┐                │
│        │                                     │                │
│   ┌────▼────┐                          ┌────▼────┐          │
│   │ Egress  │                          │ Fallback│          │
│   │ Handler │                          │ Handler │          │
│   └────┬────┘                          └────┬────┘          │
│        │                                     │                │
│   ┌────▼────┐                          ┌────▼────┐          │
│   │ Room    │                          │ LiveKit │          │
│   │Composite│                          │ Client  │          │
│   │ (RTMP)  │                          │ (WebRTC)│          │
│   └────┬────┘                          └────┬────┘          │
│        │                                     │                │
│        └─────────────┬───────────────────────┘                │
│                      │                                         │
│              ┌───────▼────────┐                                │
│              │ Audio Processor │                               │
│              │  • Decode Opus  │                               │
│              │  • Mix streams  │                               │
│              │  • Buffer       │                               │
│              └───────┬────────┘                                │
│                      │                                         │
│              ┌───────▼────────┐                                │
│              │  Gladia Bridge  │                               │
│              └───────┬────────┘                                │
│                      │                                         │
│              ┌───────▼────────┐                                │
│              │  Transcript    │                                │
│              │  Publisher     │                                │
│              └────────────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

### Компоненты

#### 1. Transcription Router
```typescript
class TranscriptionRouter {
  async route(sessionId: string, roomName: string): Promise<TranscriptionMethod> {
    const stats = await this.getRoomStats(roomName)
    const egressAvailable = await this.checkEgressAvailability()
    
    // Правило 1: Если участников > 1 и Egress доступен → Room Composite
    if (stats.participantCount > 1 && egressAvailable) {
      return TranscriptionMethod.ROOM_COMPOSITE_EGRESS
    }
    
    // Правило 2: Если участников = 1 → Fallback (экономия Egress)
    if (stats.participantCount === 1) {
      return TranscriptionMethod.CLIENT_BASED
    }
    
    // Правило 3: Если Egress недоступен → Fallback
    return TranscriptionMethod.CLIENT_BASED
  }
}
```

#### 2. Egress Handler (Room Composite)
```typescript
class RoomCompositeEgressHandler {
  async start(roomName: string): Promise<void> {
    // 1. Запускаем Room Composite Egress с RTMP
    const egressInfo = await this.startEgress(roomName)
    
    // 2. Подключаемся к RTMP потоку
    const rtmpStream = await this.connectToRTMP(egressInfo.rtmpUrl)
    
    // 3. Декодируем RTMP → PCM16
    rtmpStream.on('audio', (audioData) => {
      const pcmData = this.decodeRTMPAudio(audioData)
      this.sendToGladia(pcmData)
    })
  }
}
```

#### 3. Fallback Handler (LiveKit Client)
```typescript
class ClientBasedTranscriptionHandler {
  async start(roomName: string): Promise<void> {
    // Используем существующий код из livekit-transcriber.ts
    // Подключаемся к комнате как участник
    // Получаем треки и отправляем в Gladia
  }
}
```

### Масштабирование

**Сценарий: 500 человек в 100 комнатах**

| Метод | Сессий Egress | Сессий Fallback | Итого |
|-------|---------------|-----------------|-------|
| **Только Track Egress** | 500 | 0 | ❌ Превышение лимита |
| **Только Room Composite** | 100 | 0 | ⚠️ Нужен upgrade плана |
| **Гибридный (рекомендуется)** | 50-80 | 20-50 | ✅ Оптимально |

**Логика гибридного подхода:**
- Комнаты с 2+ участниками → Room Composite Egress (50-80 комнат)
- Комнаты с 1 участником → Fallback (20-50 комнат)
- При превышении лимита → Fallback для новых комнат

## План реализации

### Этап 1: Декодирование Opus (Критично)
1. Установить `@discordjs/opus`
2. Добавить декодер в `AudioProcessor`
3. Декодировать Opus → PCM16 перед отправкой в Gladia

### Этап 2: Room Composite Egress (Приоритет)
1. Настроить RTMP сервер
2. Реализовать `RoomCompositeEgressHandler`
3. Декодировать RTMP поток → PCM16

### Этап 3: Transcription Router (Оптимизация)
1. Создать `TranscriptionRouter`
2. Реализовать логику выбора метода
3. Добавить мониторинг использования Egress

### Этап 4: Fallback Handler (Надёжность)
1. Улучшить существующий `livekit-transcriber.ts`
2. Добавить обработку ошибок
3. Интегрировать с Router

### Этап 5: Мониторинг и метрики
1. Отслеживать использование Egress
2. Метрики производительности
3. Алерты при превышении лимитов

## Выводы

**Для масштабирования до 500+ пользователей:**

1. ✅ **Использовать Room Composite Egress** (1 сессия на комнату)
2. ✅ **Добавить fallback механизм** (для экономии Egress)
3. ✅ **Декодировать Opus** (для работы с Gladia)
4. ✅ **Настроить RTMP сервер** (для Room Composite)
5. ✅ **Реализовать Smart Routing** (оптимальное использование ресурсов)

**Результат:**
- Масштабируется до любого количества пользователей
- Оптимальное использование лимитов Egress
- Graceful degradation при превышении лимитов
- Real-time транскрипция для всех участников


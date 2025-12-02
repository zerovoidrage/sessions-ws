# Настройка LiveKit Egress для real-time транскрипции

## Проблема

LiveKit Room Composite Egress обычно не поддерживает прямой WebSocket выход для real-time обработки. Он предназначен для записи в файлы или трансляции через RTMP.

## Решение: Track Egress с WebSocket

Согласно [документации LiveKit](https://docs.livekit.io/home/egress/overview/), **Track Egress** идеально подходит для нашей задачи:

> **Track egress**: Export individual tracks directly. Video tracks aren't transcoded.
> 
> **Example use case**: streaming an audio track to a captioning service via websocket.

## Архитектура решения

### Вариант 1: Track Egress для каждого участника (рекомендуется)

1. **Получаем список участников и их треков:**
   - Используем Room Service API для получения списка участников
   - Для каждого участника получаем audio track ID

2. **Запускаем Track Egress для каждого аудио трека:**
   ```typescript
   await egressClient.startTrackEgress(
     roomName,
     websocketUrl, // WebSocket URL для получения аудио
     trackId,      // ID аудио трека участника
   )
   ```

3. **Микшируем потоки на сервере:**
   - Получаем аудио от всех WebSocket соединений
   - Микшируем через AudioProcessor
   - Отправляем в Gladia

**Преимущества:**
- ✅ Real-time (низкая задержка)
- ✅ WebSocket поддержка
- ✅ Полный контроль над микшированием

**Недостатки:**
- ⚠️ Требует получения trackId для каждого участника
- ⚠️ Множественные Egress сессии (но лимит обычно достаточен)

### Вариант 2: Room Composite с RTMP (альтернатива)

1. **Настраиваем RTMP сервер:**
   - Используем nginx-rtmp или другой RTMP сервер
   - Настраиваем приём RTMP потока от Egress

2. **Запускаем Room Composite Egress:**
   ```typescript
   await egressClient.startRoomCompositeEgress(
     roomName,
     {
       stream: {
         protocol: StreamProtocol.RTMP,
         urls: ['rtmp://your-rtmp-server/live/session-id'],
       },
     },
     { audioOnly: true }
   )
   ```

3. **Декодируем RTMP поток:**
   - Подключаемся к RTMP серверу
   - Декодируем аудио до PCM16
   - Отправляем в Gladia

**Преимущества:**
- ✅ Один поток (микширование на стороне Egress)
- ✅ Стандартный протокол

**Недостатки:**
- ⚠️ Требует RTMP сервер
- ⚠️ Дополнительная задержка (RTMP → декодирование)
- ⚠️ Сложнее в настройке

## Реализация Track Egress подхода

### Шаг 1: Получение списка треков

```typescript
import { RoomService } from 'livekit-server-sdk'

const roomService = new RoomService(livekitUrl, apiKey, apiSecret)
const room = await roomService.getRoom(roomName)

// Получаем все аудио треки участников
const audioTracks: Array<{ trackId: string, participantIdentity: string }> = []

for (const participant of room.participants) {
  for (const track of participant.tracks) {
    if (track.kind === 'audio' && track.source === 'microphone') {
      audioTracks.push({
        trackId: track.sid,
        participantIdentity: participant.identity,
      })
    }
  }
}
```

### Шаг 2: Запуск Track Egress для каждого трека

```typescript
const egressSessions = new Map<string, string>() // trackId -> egressId

for (const { trackId, participantIdentity } of audioTracks) {
  const websocketUrl = `ws://your-server:3001/egress/audio/${sessionId}/${trackId}`
  
  const info = await egressClient.startTrackEgress(
    roomName,
    websocketUrl, // WebSocket выход
    trackId,
  )
  
  egressSessions.set(trackId, info.egressId)
  console.log(`Track Egress started for ${participantIdentity}: ${info.egressId}`)
}
```

### Шаг 3: Обработка WebSocket соединений

```typescript
// В ws/server/index.ts
egressWss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const [, , sessionId, trackId] = url.pathname.split('/')
  
  // Обрабатываем аудио данные от Egress
  ws.on('message', (data) => {
    handleEgressAudioData(sessionId, trackId, data)
  })
})
```

### Шаг 4: Микширование и отправка в Gladia

```typescript
// Собираем аудио от всех треков
const audioBuffers = new Map<string, Buffer[]>()

function handleEgressAudioData(sessionId: string, trackId: string, data: Buffer) {
  if (!audioBuffers.has(trackId)) {
    audioBuffers.set(trackId, [])
  }
  audioBuffers.get(trackId)!.push(data)
  
  // Периодически микшируем и отправляем
  if (shouldMix()) {
    const mixed = AudioProcessor.mixBuffers(
      Array.from(audioBuffers.values()).flat()
    )
    gladiaBridge.sendAudio(mixed)
    audioBuffers.clear()
  }
}
```

## Настройка в LiveKit Cloud

1. **Проверьте лимиты:**
   - Откройте Settings → Project
   - Проверьте "Concurrent Egress requests" (по умолчанию: 2)
   - При необходимости upgrade план для увеличения лимита

2. **Проверьте доступность Egress:**
   - Откройте Egresses в LiveKit Cloud
   - Убедитесь, что Egress сервис активен

3. **Настройте переменные окружения:**
   ```env
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
   ```

## Следующие шаги

1. ✅ Реализовать получение списка треков через Room Service API
2. ✅ Реализовать Track Egress для каждого трека
3. ✅ Настроить WebSocket endpoint для приёма аудио
4. ✅ Реализовать микширование потоков
5. ✅ Протестировать полный цикл

## Дополнительные ресурсы

- [LiveKit Egress Overview](https://docs.livekit.io/home/egress/overview/)
- [Track Egress Documentation](https://docs.livekit.io/home/egress/track/)
- [LiveKit Server SDK](https://docs.livekit.io/home/server-api/)


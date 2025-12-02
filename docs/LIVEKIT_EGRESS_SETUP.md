# Настройка LiveKit Egress для серверной транскрипции

## Обзор

Серверная транскрипция использует **LiveKit Track Egress API** для получения аудио потоков от каждого участника и отправки их в Gladia для транскрипции.

Согласно [документации LiveKit](https://docs.livekit.io/home/egress/overview/), Track Egress идеально подходит для нашей задачи:
> **Track egress**: Export individual tracks directly. Video tracks aren't transcoded.
> 
> **Example use case**: streaming an audio track to a captioning service via websocket.

## Архитектура

```
LiveKit Room (участники говорят)
    ↓
LiveKit Track Egress (для каждого аудио трека)
    ↓
WebSocket Server (наш сервер, получает аудио от Egress)
    ↓
Микширование аудио потоков
    ↓
Gladia API (транскрипция)
    ↓
LiveKit Data Channel (публикация транскриптов для всех участников)
```

## Требования

1. **LiveKit Cloud с Egress**
   - Egress доступен автоматически в LiveKit Cloud
   - Проверьте лимиты в Settings → Project:
     - **Concurrent Egress requests**: Limit 2 (по умолчанию)
     - При необходимости upgrade план для увеличения лимита
   - Для self-hosted: нужно развернуть LiveKit Egress отдельно

2. **Переменные окружения**
   ```env
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_HTTP_URL=https://your-project.livekit.cloud  # HTTP URL для Egress API
   EGRESS_WEBSOCKET_BASE_URL=wss://your-server.com/egress/audio  # Публичный URL для получения аудио от Egress
   ```
   
   **ВАЖНО:** 
   - `EGRESS_WEBSOCKET_BASE_URL` должен быть **публичным URL**, доступным из интернета
   - Egress подключается к этому URL, поэтому **localhost не подойдёт для production**
   - Формат: `wss://your-domain.com/egress/audio` (без sessionId/trackId - они добавляются автоматически)
   - Если не указан, используется `ws://localhost:3001/egress/audio` (только для разработки)

## Настройка LiveKit Egress

### Вариант 1: LiveKit Cloud

Если используете LiveKit Cloud, проверьте:
- Доступен ли Egress в вашем плане
- Настройте Egress через LiveKit Dashboard
- Получите URL для Egress API

### Вариант 2: Self-hosted LiveKit Egress

1. **Установка LiveKit Egress:**
   ```bash
   # Docker
   docker run -d \
     --name livekit-egress \
     -p 8080:8080 \
     -e LIVEKIT_URL=ws://your-livekit-server:7880 \
     -e LIVEKIT_API_KEY=your_api_key \
     -e LIVEKIT_API_SECRET=your_api_secret \
     livekit/egress
   ```

2. **Настройка WebSocket endpoint:**
   - Egress должен отправлять аудио поток на ваш WebSocket сервер
   - URL: `ws://your-server:3001/egress/audio/{sessionId}`

## Как это работает

1. **Запуск транскрипции:**
   - При переходе сессии в статус LIVE автоматически запускается серверная транскрипция
   - Транскрайбер подключается к LiveKit комнате как участник
   - Получает список всех аудио треков участников

2. **Track Egress для каждого трека:**
   - Для каждого аудио трека запускается Track Egress с WebSocket выходом
   - Egress подключается к нашему WebSocket серверу: `wss://your-server.com/egress/audio/{sessionId}/{trackId}`
   - Аудио данные приходят в реальном времени

3. **Микширование и транскрипция:**
   - Аудио от всех треков микшируется в один поток
   - Отправляется в Gladia для транскрипции
   - Транскрипты публикуются через LiveKit data channel для всех участников

## Важные замечания

1. **Лимиты Egress:**
   - По умолчанию: 2 одновременных Egress сессии
   - При 5 участниках = 5 Egress сессий (может превысить лимит)
   - Решение: upgrade план или использовать Room Composite для микширования (но это не real-time)

2. **Формат аудио:**
   - Track Egress отправляет аудио в формате трека (обычно Opus)
   - Может потребоваться декодирование до PCM16 16kHz для Gladia
   - TODO: Добавить декодирование Opus, если необходимо

3. **Real-time задержка:**
   - Track Egress добавляет минимальную задержку (обычно 50-200ms)
   - Это приемлемо для транскрипции

## Альтернативные подходы

Если LiveKit Egress недоступен или не подходит:

1. **Track Egress:**
   - Получать отдельные треки участников
   - Микшировать на сервере
   - Более сложно, но даёт больше контроля

2. **WebRTC полифиллы:**
   - Использовать `wrtc` или `node-webrtc`
   - Подключаться к комнате как участник
   - Получать треки напрямую

3. **Гибридный подход:**
   - Временно использовать клиентскую транскрипцию
   - Постепенно мигрировать на серверную

## Тестирование

1. **Проверка Egress доступности:**
   ```bash
   curl https://your-livekit-server.com/egress/health
   ```

2. **Запуск тестовой сессии:**
   - Создайте сессию
   - Проверьте логи WebSocket сервера
   - Убедитесь, что Egress подключается

3. **Проверка транскрипции:**
   - Говорите в микрофон
   - Проверьте, что транскрипты появляются в UI
   - Проверьте логи Gladia

## Troubleshooting

### Egress не запускается
- Проверьте переменные окружения
- Убедитесь, что LiveKit сервер доступен
- Проверьте логи Egress

### Аудио не приходит
- Проверьте WebSocket соединение
- Убедитесь, что Egress настроен правильно
- Проверьте формат аудио данных

### Транскрипты не публикуются
- Проверьте подключение к комнате
- Убедитесь, что токен имеет права `canPublishData`
- Проверьте логи публикации

## Дополнительные ресурсы

- [LiveKit Egress Documentation](https://docs.livekit.io/home/egress/)
- [LiveKit Egress GitHub](https://github.com/livekit/egress)
- [LiveKit Server SDK](https://docs.livekit.io/home/server-api/)


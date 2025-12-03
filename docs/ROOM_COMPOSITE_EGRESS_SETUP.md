# Настройка Room Composite Egress для транскрипции

## Архитектура

**Room Composite Egress → RTMP → RTMP Ingest Server → FFmpeg → PCM16 → Gladia**

### Преимущества

✅ **1 Egress сессия на комнату** (вместо N Track Egress)
- При 5 участниках: 1 сессия вместо 5
- При 10 участниках: 1 сессия вместо 10
- На Scale плане: unlimited egress → не думаем о количестве участников

✅ **Микширование на стороне LiveKit** (оптимизировано)
- LiveKit сам микширует все аудио треки в один поток
- Оптимизированное снижение битрейта
- SFU-уровневая обработка

✅ **Идеально для speaker diarization**
- Gladia получает один микшированный поток
- Может определить спикеров через AI-based diarization
- Не нужно отслеживать отдельные треки

## Требования

### 1. FFmpeg

FFmpeg должен быть установлен в системе для декодирования RTMP → PCM16.

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
apt-get install ffmpeg
# или
yum install ffmpeg
```

**Проверка:**
```bash
ffmpeg -version
```

### 2. Переменные окружения

Добавьте в `.env`:

```env
# LiveKit (уже должно быть)
LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# RTMP сервер (для приема потока от Egress)
RTMP_PORT=1935  # Порт RTMP сервера (по умолчанию 1935)
RTMP_HOST=your-public-ip-or-domain.com  # ВАЖНО: публичный IP/домен для production
```

**⚠️ ПРОБЛЕМА: Render не поддерживает кастомные TCP порты**

Render (где у вас WebSocket сервер) **не позволяет открыть RTMP порт 1935** напрямую, так как:
- Render предоставляет только HTTP/HTTPS на стандартных портах
- RTMP требует TCP соединения на порт 1935
- Кастомные порты недоступны на Render Free/Starter планах

**Решения:**

#### Вариант 1: ngrok для production (быстрое решение)

Используйте ngrok для туннелирования RTMP порта:

1. **Установите ngrok:**
   ```bash
   brew install ngrok  # macOS
   # или скачайте с https://ngrok.com
   ```

2. **Создайте ngrok туннель:**
   ```bash
   ngrok tcp 1935
   ```

3. **Получите хост из вывода:**
   ```
   Forwarding  tcp://0.tcp.ngrok.io:12345 -> localhost:1935
   ```

4. **Установите переменные окружения на Render:**
   ```env
   RTMP_PORT=12345  # Порт из ngrok
   RTMP_HOST=0.tcp.ngrok.io  # Хост из ngrok
   ```

5. **Обновите RTMP URL в коде:**
   - Нужно использовать порт из ngrok, а не 1935

**⚠️ Ограничения ngrok:**
- Free план: ограничения по трафику и времени работы
- TCP туннели требуют ngrok account
- Хост меняется при перезапуске (нужно обновлять переменные)

#### Вариант 2: Отдельный VPS для RTMP (рекомендуется для production)

Создайте отдельный VPS (например, на DigitalOcean, AWS, Hetzner) для RTMP сервера:

1. **Создайте VPS** с публичным IP
2. **Установите RTMP сервер** (node-media-server или nginx-rtmp)
3. **Настройте firewall** для открытия порта 1935
4. **Используйте IP/домен VPS** в `RTMP_HOST`

**Пример для DigitalOcean Droplet ($6/месяц):**
```env
RTMP_HOST=your-vps-ip.com
RTMP_PORT=1935
```

#### Вариант 3: Альтернативный RTMP сервис

Используйте managed RTMP сервис:
- **Cloudflare Stream** (платный)
- **AWS MediaLive** (платный)
- **Mux** (платный)

#### Вариант 4: Локальная разработка

Для локальной разработки используйте `localhost`:

```env
RTMP_HOST=localhost
RTMP_PORT=1935
```

**Но:** LiveKit Egress из облака не сможет подключиться к localhost, поэтому:
- Используйте ngrok для локальной разработки тоже
- Или тестируйте только на production

### 3. Настройка RTMP сервера

RTMP сервер запускается автоматически при старте WebSocket сервера (`npm run dev:ws`).

Порт по умолчанию: `1935` (стандартный RTMP порт).

## Как это работает

### 1. Запуск транскрипции

Когда участник присоединяется к сессии и статус меняется на `LIVE`:

1. **Next.js API** вызывает `/api/transcription/start` на WebSocket сервере
2. **WebSocket сервер** запускает `startRoomCompositeTranscription`:
   - Создает RTMP Ingest обработчик для сессии
   - Запускает Room Composite Egress через LiveKit API
   - Egress микширует все аудио треки и стримит в RTMP

### 2. Прием RTMP потока

1. **RTMP сервер** (node-media-server) принимает поток от Egress
2. **FFmpeg** подключается к RTMP потоку и декодирует в PCM16 16kHz mono
3. **Gladia bridge** получает PCM16 данные и отправляет в Gladia API

### 3. Обработка транскриптов

1. **Gladia** возвращает транскрипты с speaker diarization (если включено)
2. **WebSocket сервер** отправляет транскрипты всем подключенным клиентам сессии
3. **Клиенты** получают транскрипты в real-time через WebSocket

### 4. Остановка транскрипции

Когда сессия завершается:

1. **Next.js API** вызывает `/api/transcription/stop` на WebSocket сервере
2. **WebSocket сервер** останавливает Room Composite Egress
3. **RTMP поток** завершается
4. **FFmpeg** автоматически завершается
5. **Gladia bridge** закрывается

## Speaker Diarization

### Настройка в Gladia

Gladia автоматически пытается включить speaker diarization при создании сессии.

Параметры в `gladia-bridge.ts`:
```typescript
{
  diarization: true, // Включаем diarization
  // ...
}
```

### Маппинг спикеров

Gladia возвращает `speaker_id` (например, "speaker_0", "speaker_1") в транскриптах.

Для маппинга на реальных участников можно использовать:
- **LiveKit active speaker events** (кто говорит в данный момент)
- **Временные метки** транскриптов и активных спикеров
- **Post-call анализ** для более точного маппинга

См. `ws/server/speaker-mapper.ts` для базовой реализации.

## Troubleshooting

### FFmpeg не найден

```
Error: spawn ffmpeg ENOENT
```

**Решение:** Установите FFmpeg (см. требования выше).

### RTMP поток не подключается

**Проблема:** Egress не может подключиться к RTMP серверу.

**Проверьте:**
1. `RTMP_HOST` установлен на публичный IP/домен (не localhost)
2. Порт `RTMP_PORT` открыт в firewall
3. RTMP сервер запущен (проверьте логи WebSocket сервера)

**Для локальной разработки:**
```bash
# Используйте ngrok для туннелирования RTMP порта
ngrok tcp 1935
# Используйте полученный хост в RTMP_HOST
```

### FFmpeg не может подключиться к RTMP потоку

**Проблема:** FFmpeg выдает ошибку подключения.

**Проверьте:**
1. RTMP сервер запущен и принимает подключения
2. Egress успешно стримит в RTMP (проверьте логи Egress)
3. RTMP URL правильный: `rtmp://RTMP_HOST:RTMP_PORT/live/SESSION_SLUG`

### Нет транскриптов

**Проблема:** Транскрипты не приходят.

**Проверьте:**
1. Gladia API ключ установлен (`GLADIA_API_KEY`)
2. FFmpeg успешно декодирует поток (проверьте логи)
3. Gladia bridge подключен (проверьте логи)

## Fallback

Если Room Composite Egress не работает, система автоматически переключается на **Track Egress** (старый подход).

Это обеспечивает надежность даже при проблемах с RTMP или Room Composite.

## Стоимость

### LiveKit Egress

- **Scale план:** Unlimited concurrent egress → **$500/месяц фиксированно**
- Не зависит от количества участников или комнат
- Одна крупная фиксированная статья расходов

### Gladia

- **1 поток на комнату** (вместо N потоков)
- При 5 участниках: экономия **80%** (1 поток вместо 5)
- При 10 участниках: экономия **90%** (1 поток вместо 10)

### Итого

- **До:** N участников = N Gladia потоков = N × стоимость
- **После:** N участников = 1 Gladia поток = 1 × стоимость
- **Экономия:** до 99% на транскрипции при большом количестве участников


# Исправление конфигурации WebSocket

**Дата:** 2024-12-28  
**Проблема:** Ошибка "Invalid frame header" при подключении к WebSocket на Railway  
**Решение:** Упрощение конфигурации, использование стандартных портов

---

## Изменения

### 1. WebSocket сервер (Railway - sessions-ws)

#### `ws-server/server/index.ts`

**Изменения:**
- Используется `process.env.PORT` вместо жёсткого `3001`
- Все эндпоинты на одном `http.Server`
- Добавлено логирование upgrade запросов

**Ключевой код:**

```typescript
// Используем PORT из окружения (Railway автоматически устанавливает его)
// Fallback на 3001 только для локальной разработки
const port = Number(process.env.PORT) || 3001

// Создаем HTTP сервер для WebSocket upgrade
const server = http.createServer()

// HTTP endpoint для метрик, health check, API
server.on('request', (req, res) => {
  // ... обработка HTTP запросов
})

// WebSocketServer автоматически обрабатывает upgrade запросы
// Добавляем явный обработчик для логирования
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname
  console.log(`[WS-SERVER] 🔄 Upgrade request: ${pathname}`)
})

const wss = new WebSocketServer({
  server,
  path: '/api/realtime/transcribe',
})

wss.on('connection', (ws, req: http.IncomingMessage) => {
  console.log(`[WS-SERVER] ✅ WebSocket connection established: ${req.url}`)
  handleClientConnection({ ws, req })
})

server.listen(port, async () => {
  console.log(`[WS-SERVER] WebSocket server listening on port ${port}`)
  // ...
})
```

**Важно:**
- Все эндпоинты (`/api/transcription/start`, `/api/active-speaker`, `/metrics`, `/health`) и WebSocket (`/api/realtime/transcribe`) используют один и тот же `http.Server`
- WebSocketServer автоматически обрабатывает upgrade запросы для указанного `path`

---

### 2. Frontend (Next.js на Vercel)

#### `src/hooks/useLocalParticipantTranscription.ts`

**Изменения:**
- Убрано использование `NEXT_PUBLIC_WS_PORT`
- Упрощена логика формирования URL
- Для production: без порта (Railway проксирует через 443)
- Для dev: `localhost:3001`

**Ключевой код:**

```typescript
// Определяем протокол и хост для WebSocket
// Railway — это всегда TLS, поэтому для удалённого хоста всегда wss://
// Для localhost используем ws:// с портом
const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
const cleanHost = wsHost.replace(/^https?:\/\//, '').replace(/\/$/, '')

// Проверяем, является ли хост локальным
const isRemoteHost = cleanHost !== 'localhost' && !cleanHost.startsWith('127.0.0.1') && !cleanHost.startsWith('192.168.')

// Протокол: для удалённого хоста (Railway) всегда wss, для localhost — зависит от window.location.protocol
const wsProtocol = isRemoteHost
  ? 'wss'
  : (typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws')

// Порт: только для локального хоста
// Если указан NEXT_PUBLIC_WS_PORT, используем его, иначе fallback на 3001 для localhost
const wsPort = process.env.NEXT_PUBLIC_WS_PORT
const baseUrl = !isRemoteHost
  ? `${wsProtocol}://${cleanHost}:${wsPort || '3001'}`
  : `${wsProtocol}://${cleanHost}`

const wsUrl = `${baseUrl}/api/realtime/transcribe?token=${encodeURIComponent(transcriptionToken)}`
```

**Логика:**
- **Production (Railway):** `wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=...`
  - Всегда `wss://` (Railway всегда TLS)
  - Без порта (Railway проксирует через 443)
  - Не зависит от `window.location.protocol` фронта
  
- **Dev (localhost):** `ws://localhost:3001/api/realtime/transcribe?token=...`
  - `ws://` или `wss://` в зависимости от `window.location.protocol`
  - С портом (`NEXT_PUBLIC_WS_PORT` или `3001` по умолчанию)

#### `src/hooks/useActiveSpeakerTracker.ts`

**Изменения:**
- Использует `WS_SERVER_URL` для HTTP API запросов
- Убрано использование `NEXT_PUBLIC_WS_PORT`

**Ключевой код:**

```typescript
// Используем WS_SERVER_URL для HTTP API запросов
// Для локальной разработки: http://localhost:3001
// Для production: https://sessions-ws-production.up.railway.app
const apiBaseUrl = process.env.WS_SERVER_URL || (typeof window !== 'undefined' && window.location.protocol === 'https:' 
  ? 'https://sessions-ws-production.up.railway.app' 
  : 'http://localhost:3001')
```

---

## Конфигурация переменных окружения

### Vercel (Frontend)

**Обязательные переменные:**

```env
# WebSocket сервер для клиентских WebSocket подключений
# Только домен, без протокола и порта
NEXT_PUBLIC_WS_HOST=sessions-ws-production.up.railway.app

# WebSocket сервер для HTTP API вызовов (start/stop transcription, active speaker)
# Полный URL с протоколом, без порта
WS_SERVER_URL=https://sessions-ws-production.up.railway.app
```

**Удалить (если есть):**
- ❌ `NEXT_PUBLIC_WS_PORT` - больше не используется

### Railway (WebSocket Server)

**Обязательные переменные:**

```env
# ❌ НЕ УСТАНАВЛИВАЙТЕ PORT или WS_PORT!
# Railway САМ подставит верный PORT внутрь контейнера
# Удалите, если есть:
# PORT=8000 ❌
# WS_PORT=8000 ❌

# LiveKit
LIVEKIT_HTTP_URL=https://omni-pxx5e1ko.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Gladia
GLADIA_API_KEY=your-gladia-key

# Database
DATABASE_URL=postgresql://...

# JWT Secret (должен совпадать с Vercel)
TRANSCRIPTION_JWT_SECRET=your-secret

# RTMP
RTMP_PORT=1935
RTMP_HOST=sessions-ws-production.up.railway.app
```

**⚠️ КРИТИЧЕСКИ ВАЖНО: Настройки Railway Networking**

1. **Перейдите в Railway → Ваш сервис → Settings → Public Networking**
2. **Найдите секцию с доменом:**
   ```
   sessions-ws-production.up.railway.app
   Port 8000 ▼  ← ЭТО НУЖНО ИЗМЕНИТЬ
   ```
3. **Нажмите на выпадающий список "Port 8000"**
4. **Выберите "DEFAULT" или "Auto-detect"**
   - ❌ НЕ оставляйте 8000, 5000, 3001 или любой другой конкретный порт
   - ✅ Выберите "DEFAULT" или "Auto-detect"
5. **Сохраните изменения**

**После исправления:**
- Railway автоматически установит PORT (например, 42577)
- Ваш сервер начнёт слушать этот порт
- Railway будет выполнять WebSocket upgrade корректно

**Как это работает:**
- Railway автоматически устанавливает переменную `PORT` внутри контейнера
- Ваш код читает `process.env.PORT` и слушает на этом порту
- Railway проксирует внешний HTTPS (443) → внутренний PORT
- Вам НЕ нужно знать, какой именно порт использует Railway

---

## Проверка конфигурации

### 1. Проверка HTTP эндпоинтов

```bash
# Health check
curl https://sessions-ws-production.up.railway.app/health

# Ожидаемый ответ:
# {"status":"ok","timestamp":"...","queueLength":0}

# Metrics
curl https://sessions-ws-production.up.railway.app/metrics

# Ожидаемый ответ:
# JSON с метриками сервера
```

### 2. Проверка WebSocket эндпоинта

```bash
# Проверка upgrade запроса
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=TEST

# Ожидаемый ответ:
# HTTP/1.1 101 Switching Protocols
# Upgrade: websocket
# Connection: Upgrade
# Sec-WebSocket-Accept: ...
```

### 3. Проверка через wscat

```bash
# Установка wscat (если не установлен)
npm install -g wscat

# Подключение к WebSocket
npx wscat -c "wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=TEST"

# Ожидаемое поведение:
# - Подключение устанавливается
# - Сервер может закрыть соединение из-за невалидного токена (это нормально)
# - Главное - нет ошибки "Invalid frame header"
```

### 4. Проверка в браузере

```javascript
// В консоли браузера на странице сессии
const ws = new WebSocket('wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=VALID_TOKEN')

ws.onopen = () => {
  console.log('✅ WebSocket connected')
}

ws.onerror = (error) => {
  console.error('❌ WebSocket error:', error)
}

ws.onclose = (event) => {
  console.log('WebSocket closed:', event.code, event.reason)
}
```

---

## Диагностика проблем

### Проблема: "Invalid frame header"

**Возможные причины:**
1. Railway не проксирует WebSocket через стандартный порт 443
2. Неправильный URL (с портом для production)
3. Сервер не обрабатывает upgrade запросы

**Решение:**
1. Проверить логи Railway WebSocket сервера
2. Убедиться, что `NEXT_PUBLIC_WS_HOST` не содержит порт
3. Проверить, что `WS_SERVER_URL` правильный (с `https://`)
4. Проверить, что сервер слушает на `process.env.PORT`

### Проблема: WebSocket подключается, но сразу закрывается

**Возможные причины:**
1. Невалидный токен
2. Ошибка в `handleClientConnection`

**Решение:**
1. Проверить логи Railway на ошибки валидации токена
2. Проверить, что `TRANSCRIPTION_JWT_SECRET` совпадает в Vercel и Railway

### Проблема: HTTP эндпоинты не работают

**Возможные причины:**
1. Неправильный `WS_SERVER_URL`
2. Сервер не запущен

**Решение:**
1. Проверить логи Railway
2. Проверить, что `WS_SERVER_URL` правильный (с `https://`, без порта)

---

## Итоговая структура

### WebSocket сервер (Railway)

```
ws-server/server/index.ts
├── HTTP Server (один для всех)
│   ├── /health (GET)
│   ├── /metrics (GET)
│   ├── /api/transcription/start (POST)
│   ├── /api/transcription/stop (POST)
│   ├── /api/active-speaker (POST)
│   └── /api/realtime/transcribe (WebSocket)
│
└── Порт: process.env.PORT (Railway устанавливает автоматически)
```

### Frontend (Vercel)

```
Переменные окружения:
├── NEXT_PUBLIC_WS_HOST (для WebSocket)
│   └── sessions-ws-production.up.railway.app
│
└── WS_SERVER_URL (для HTTP API)
    └── https://sessions-ws-production.up.railway.app

Использование:
├── WebSocket: wss://{NEXT_PUBLIC_WS_HOST}/api/realtime/transcribe
└── HTTP API: {WS_SERVER_URL}/api/transcription/start
```

---

## Следующие шаги

1. ✅ Обновить код в репозиториях
2. ⏳ Обновить переменные окружения в Vercel
3. ⏳ Проверить переменные окружения в Railway
4. ⏳ Протестировать подключение через wscat
5. ⏳ Протестировать в браузере

---

**Последнее обновление:** 2024-12-28


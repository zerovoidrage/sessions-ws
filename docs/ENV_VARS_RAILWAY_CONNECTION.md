# Переменные окружения для подключения к Railway WebSocket серверу

## Для локальной разработки (`.env.local`)

```env
# Railway WebSocket сервер (HTTP API для серверных вызовов)
WS_SERVER_URL=https://your-app.up.railway.app

# Railway WebSocket сервер (для клиентских WebSocket подключений)
NEXT_PUBLIC_WS_HOST=your-app.up.railway.app
NEXT_PUBLIC_WS_PORT=443  # Опционально, обычно не нужен для HTTPS
```

## Для Vercel (Environment Variables)

### Production

```env
# Railway WebSocket сервер (HTTP API для серверных вызовов)
WS_SERVER_URL=https://your-app.up.railway.app

# Railway WebSocket сервер (для клиентских WebSocket подключений)
NEXT_PUBLIC_WS_HOST=your-app.up.railway.app
# NEXT_PUBLIC_WS_PORT не нужен для production (стандартный порт 443)
```

### Preview / Development

```env
# Railway WebSocket сервер (HTTP API для серверных вызовов)
WS_SERVER_URL=https://your-app.up.railway.app

# Railway WebSocket сервер (для клиентских WebSocket подключений)
NEXT_PUBLIC_WS_HOST=your-app.up.railway.app
NEXT_PUBLIC_WS_PORT=443  # Опционально
```

## Как получить Railway домен

1. Зайдите в Railway проект
2. Откройте ваш сервис `sessions-ws`
3. В настройках найдите **"Settings"** → **"Networking"**
4. Скопируйте **Public Domain** (например, `your-app.up.railway.app`)
5. Используйте этот домен в переменных окружения

## Описание переменных

### `WS_SERVER_URL` (серверная, Next.js API routes)

**Где используется:**
- `src/modules/core/sessions/application/startServerTranscription.ts`
- `src/modules/core/sessions/application/stopServerTranscription.ts`
- `src/modules/core/sessions/application/upsertParticipantOnJoin.ts`

**Формат:**
- Production: `https://your-app.up.railway.app`
- Local: `http://localhost:3001` (если запускаете локально)

**Важно:**
- Используется для HTTP API вызовов к Railway серверу
- Должен быть полный URL с протоколом (`https://` или `http://`)
- Не добавляйте порт для production (Railway автоматически проксирует)

### `NEXT_PUBLIC_WS_HOST` (клиентская, браузер)

**Где используется:**
- `src/hooks/useLocalParticipantTranscription.ts`

**Формат:**
- Production: `your-app.up.railway.app`
- Local: `localhost`

**Важно:**
- Используется для WebSocket подключений из браузера
- Без протокола (`ws://` или `wss://`) - протокол определяется автоматически
- Без порта (стандартные порты: 443 для WSS, 80 для WS)

### `NEXT_PUBLIC_WS_PORT` (клиентская, опционально)

**Где используется:**
- `src/hooks/useLocalParticipantTranscription.ts`

**Формат:**
- Production: обычно не нужен (стандартный порт 443)
- Local: `3001` (если запускаете локально)

**Важно:**
- Используется только если Railway использует нестандартный порт
- Обычно не нужен для production

## Примеры конфигурации

### Локальная разработка (Railway сервер на Railway, Next.js локально)

```env
# .env.local
WS_SERVER_URL=https://your-app.up.railway.app
NEXT_PUBLIC_WS_HOST=your-app.up.railway.app
```

### Локальная разработка (оба сервера локально)

```env
# .env.local
WS_SERVER_URL=http://localhost:3001
NEXT_PUBLIC_WS_HOST=localhost
NEXT_PUBLIC_WS_PORT=3001
```

### Production (Vercel + Railway)

```env
# Vercel Environment Variables
WS_SERVER_URL=https://your-app.up.railway.app
NEXT_PUBLIC_WS_HOST=your-app.up.railway.app
```

## Проверка подключения

### Проверка HTTP API (серверная)

```bash
# Проверьте, что Railway сервер отвечает
curl https://your-app.up.railway.app/health

# Должен вернуть: {"status":"ok"}
```

### Проверка WebSocket (клиентская)

1. Откройте браузерную консоль
2. Подключитесь к сессии
3. Проверьте логи:
   ```
   [Transcription] WebSocket URL constructed
   [WebSocket] Connected successfully
   ```

## Troubleshooting

### Ошибка: "Failed to connect to WebSocket"

**Причина:** Неправильный `NEXT_PUBLIC_WS_HOST` или порт

**Решение:**
1. Проверьте, что `NEXT_PUBLIC_WS_HOST` = Railway домен (без `https://`)
2. Убедитесь, что Railway сервер запущен
3. Проверьте, что порт не указан (или указан правильно)

### Ошибка: "HTTP 404" при вызове API

**Причина:** Неправильный `WS_SERVER_URL`

**Решение:**
1. Проверьте, что `WS_SERVER_URL` = `https://your-app.up.railway.app` (с протоколом)
2. Убедитесь, что Railway сервер запущен
3. Проверьте логи Railway на ошибки

### WebSocket подключается, но транскрипция не работает

**Причина:** Серверная транскрипция не запущена

**Решение:**
1. Проверьте логи Railway на ошибки запуска транскрипции
2. Убедитесь, что все переменные окружения установлены на Railway
3. Проверьте, что `WS_SERVER_URL` правильный в Vercel


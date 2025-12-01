# Настройка Render для WebSocket сервера

## 1. Создание Web Service на Render

1. Зайдите в Render Dashboard: https://dashboard.render.com
2. Нажмите **"New +"** → **"Web Service"**
3. Подключите репозиторий `git@gitlab.com:skilllzhello/sessions-ws.git`
4. Настройки:
   - **Name:** `sessions-ws` (или любое другое имя)
   - **Environment:** `Docker`
   - **Region:** выберите ближайший регион
   - **Branch:** `main`
   - **Root Directory:** `/` (корень репозитория)

## 2. Переменные окружения

Добавьте следующие Environment Variables в Render:

### База данных
- **Key:** `DATABASE_URL`
- **Value:** та же строка подключения к PostgreSQL, что используется в Vercel
- **Пример:** `postgresql://user:password@host:5432/database?sslmode=require`

### WebSocket Server
- **Key:** `WS_PORT`
- **Value:** `10000` (Render использует порт из переменной `PORT`, но лучше явно указать)
- **Или:** используйте переменную `PORT` (Render автоматически устанавливает её)

### Gladia API
- **Key:** `GLADIA_API_KEY`
- **Value:** ваш API ключ от Gladia

### LiveKit (если нужно для транскрипции)
- **Key:** `LIVEKIT_API_KEY`
- **Value:** API ключ LiveKit
- **Key:** `LIVEKIT_API_SECRET`
- **Value:** API секрет LiveKit
- **Key:** `LIVEKIT_URL`
- **Value:** URL LiveKit сервера (например, `wss://your-project.livekit.cloud`)

### JWT Secret для транскрипции
- **Key:** `TRANSCRIPTION_JWT_SECRET`
- **Value:** тот же секрет, что используется в Vercel (для верификации JWT токенов транскрипции)
- ⚠️ **Важно:** Это должен быть тот же секрет, что и `TRANSCRIPTION_JWT_SECRET` в Vercel

### Node Environment
- **Key:** `NODE_ENV`
- **Value:** `production`

## 3. Настройка порта

Render автоматически устанавливает переменную `PORT`, но WebSocket сервер ожидает `WS_PORT`. 

Обновите `ws/server/index.ts` чтобы использовать `PORT` от Render:

```typescript
const PORT = process.env.PORT || process.env.WS_PORT || 3001
```

Или установите переменную окружения:
- **Key:** `PORT`
- **Value:** `10000` (или любой другой порт)

## 4. Health Check

Render будет проверять здоровье сервиса через HTTP endpoint. Убедитесь, что `/health` endpoint работает:

```
GET https://your-ws-service.onrender.com/health
```

Ожидаемый ответ:
```json
{"status":"ok","timestamp":"2025-12-01T..."}
```

## 5. Интеграция с Vercel

### В Vercel добавьте переменные окружения:

1. **WebSocket Server Host:**
   - **Key:** `NEXT_PUBLIC_WS_HOST`
   - **Value:** `sessions-ws.onrender.com` (БЕЗ `https://` и БЕЗ слеша в конце)
   - ⚠️ **Важно:** Только доменное имя, без протокола

2. **WebSocket Server Port:**
   - **Key:** `NEXT_PUBLIC_WS_PORT`
   - **Value:** `10000` (ОБЯЗАТЕЛЬНО!)
   - ⚠️ **КРИТИЧЕСКИ ВАЖНО:** Render не проксирует WebSocket на стандартный порт 443
   - Если порт указан в переменной окружения, он будет использован даже для production
   - Без указания порта WebSocket не подключится к Render серверу

### Как работает автоматическое определение протокола:

Код в `src/hooks/useLocalParticipantTranscription.ts` автоматически:
- Определяет, что мы в production (если `window.location.protocol === 'https:'`)
- Использует `wss://` для HTTPS и `ws://` для HTTP
- **Если `NEXT_PUBLIC_WS_PORT` указан:** порт добавляется в URL даже для production
- **Если `NEXT_PUBLIC_WS_PORT` не указан:** для WSS используется стандартный порт 443 (не указывается в URL)
- Для WS указывает порт из `NEXT_PUBLIC_WS_PORT` (по умолчанию 3001)

### Пример URL для Render:
- С портом: `wss://sessions-ws.onrender.com:10000/api/realtime/transcribe?token=...`
- Без порта (не работает на Render): `wss://sessions-ws.onrender.com/api/realtime/transcribe?token=...`

## 6. CORS (если нужно)

Если браузер жалуется на CORS, добавьте CORS headers в WebSocket сервер.

## 7. Автоматическое развертывание

После настройки, Render будет автоматически деплоить при каждом push в `main` ветку репозитория `sessions-ws`.

## 8. Логи и отладка

- Логи доступны в Render Dashboard → ваш сервис → **"Logs"**
- Health check: `https://your-ws-service.onrender.com/health`
- Metrics: `https://your-ws-service.onrender.com/metrics`

## 9. Проблемы и решения

### Проблема: WebSocket не подключается
- **Проверьте, что `NEXT_PUBLIC_WS_PORT=10000` установлена в Vercel**
- Убедитесь, что используется `wss://` для HTTPS
- Проверьте, что порт добавляется в URL (должно быть `wss://host:10000/...`)
- Проверьте firewall настройки Render
- Проверьте логи в Render Dashboard для ошибок подключения

### Проблема: Health check fails
- Убедитесь, что `/health` endpoint работает
- Проверьте логи в Render Dashboard

### Проблема: DATABASE_URL не найден
- Убедитесь, что переменная окружения добавлена в Render
- Проверьте, что значение правильное (без кавычек)


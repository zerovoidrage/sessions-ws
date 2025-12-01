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
   - **Value:** `10000` (или не указывайте, если используете стандартный порт 443 для WSS)
   - ⚠️ **Важно:** Для production (HTTPS/WSS) код автоматически использует WSS на стандартном порту 443
   - Порт указывается только для dev-окружения (localhost)

### Как работает автоматическое определение протокола:

Код в `src/hooks/useLocalParticipantTranscription.ts` автоматически:
- Определяет, что мы в production (если `window.location.protocol === 'https:'`)
- Использует `wss://` для HTTPS и `ws://` для HTTP
- Для WSS не указывает порт (используется стандартный 443)
- Для WS указывает порт из `NEXT_PUBLIC_WS_PORT` (по умолчанию 3001)

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
- Проверьте, что порт правильно настроен
- Убедитесь, что используется `wss://` для HTTPS
- Проверьте firewall настройки Render

### Проблема: Health check fails
- Убедитесь, что `/health` endpoint работает
- Проверьте логи в Render Dashboard

### Проблема: DATABASE_URL не найден
- Убедитесь, что переменная окружения добавлена в Render
- Проверьте, что значение правильное (без кавычек)


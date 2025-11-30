# Инструкция по деплою

## Архитектура

Приложение состоит из двух частей:
1. **Next.js приложение** - деплоится на Vercel
2. **WebSocket сервер** (`server-websocket.js`) - деплоится на отдельном сервисе (Railway/Render/Fly.io)

## Шаг 1: Деплой WebSocket сервера

### Вариант A: Railway (рекомендуется)

1. Перейди на [railway.app](https://railway.app) и залогинься через GitHub
2. Создай новый проект → "Deploy from GitHub repo"
3. Выбери свой репозиторий
4. В настройках проекта:
   - **Build Command**: (оставить пустым, Railway использует Dockerfile)
   - **Start Command**: `node server-websocket.js`
   - **Root Directory**: `/`
5. В разделе **Variables** добавь переменные окружения:
   ```
   OPENAI_API_KEY=твой_openai_key
   WS_PORT=3001
   NODE_ENV=production
   ```
6. Railway автоматически присвоит домен типа `your-app.up.railway.app`
7. Скопируй этот домен - он понадобится для Vercel

### Вариант B: Render

1. Перейди на [render.com](https://render.com) и залогинься
2. Создай новый **Web Service**
3. Подключи GitHub репозиторий
4. Настройки:
   - **Build Command**: `npm install`
   - **Start Command**: `node server-websocket.js`
   - **Instance Type**: Free или Starter
5. В разделе **Environment Variables** добавь:
   ```
   OPENAI_API_KEY=твой_openai_key
   WS_PORT=3001
   ```
6. Render присвоит домен типа `your-app.onrender.com`
7. ⚠️ **Важно**: На бесплатном тарифе Render "засыпает" после 15 минут бездействия. Для production лучше использовать платный план или Railway.

### Вариант C: Fly.io

1. Установи Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Логинься: `fly auth login`
3. Создай приложение: `fly launch --name your-ws-server`
4. В файле `fly.toml` (будет создан автоматически) настрой:
   ```toml
   [env]
     OPENAI_API_KEY = "твой_openai_key"
     WS_PORT = "3001"
   ```
5. Деплой: `fly deploy`

## Шаг 2: Деплой Next.js на Vercel

1. Перейди на [vercel.com](https://vercel.com) и залогинься через GitHub
2. Импортируй проект из GitHub
3. В настройках проекта → **Environment Variables** добавь:

   ```
   # Database
   DATABASE_URL=твой_neon_url

   # LiveKit
   LIVEKIT_API_KEY=твой_livekit_key
   LIVEKIT_API_SECRET=твой_livekit_secret
   NEXT_PUBLIC_LIVEKIT_URL=wss://твой_livekit_url

   # OpenAI (нужен только для Next.js, если используешь refineGrammar на клиенте)
   OPENAI_API_KEY=твой_openai_key

   # WebSocket сервер (используй домен из Railway/Render/Fly.io)
   NEXT_PUBLIC_WS_HOST=your-app.up.railway.app  # или your-app.onrender.com
   NEXT_PUBLIC_WS_PORT=443  # для HTTPS (80 для HTTP, но лучше 443)

   # Дополнительно
   WS_PORT=3001  # для локальной разработки
   ```

4. ⚠️ **Важно**: Если WebSocket сервер использует HTTPS (Railway, Render), используй:
   - `NEXT_PUBLIC_WS_PORT=443`
   - В коде клиента измени протокол на `wss://` вместо `ws://`

5. Нажми **Deploy**

## Шаг 3: Обновление клиентского кода для production

Проверь файл `src/hooks/useLocalParticipantTranscription.ts` - там должно быть что-то вроде:

```typescript
const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '3001'
const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/api/realtime/transcribe`
```

Если такого нет - нужно добавить поддержку HTTPS для production.

## Шаг 4: Проверка

1. Открой деплой Vercel
2. Создай комнату
3. Открой DevTools → Network → WS
4. Проверь, что WebSocket подключение идет к правильному домену (Railway/Render)
5. Проверь, что транскрипция работает

## Troubleshooting

### WebSocket не подключается
- Проверь, что `NEXT_PUBLIC_WS_HOST` правильный
- Проверь, что WebSocket сервер запущен и доступен
- Для HTTPS используй `wss://` и порт `443`
- Проверь CORS настройки (если нужно)

### Транскрипция не работает
- Проверь логи WebSocket сервера на Railway/Render
- Проверь, что `OPENAI_API_KEY` установлен
- Проверь консоль браузера на ошибки

### Vercel build fails
- Проверь, что все зависимости в `package.json`
- Проверь, что Prisma schema корректный
- Запусти локально `npm run build` перед деплоем

## Мониторинг

- **Vercel**: Логи в Dashboard → Functions
- **Railway**: Логи в Dashboard → Deployments → Logs
- **Render**: Логи в Dashboard → Events




# Локальный запуск WS сервера

## Для локальной разработки используй эту папку (`ws-server/`)

```bash
cd ws-server

# Установить зависимости (если ещё не установлены)
npm install

# Запустить в режиме разработки
npm run dev

# Или запустить production
npm start
```

## Важно

- **Локально запускай из папки `ws-server/`**
- В корне проекта не нужно запускать `npm run dev` - это для Next.js фронтенда
- WS сервер - это отдельный репозиторий на GitHub
- Для деплоя используется Railway (автоматически при push в GitHub)

## Переменные окружения

Создай файл `.env` в папке `ws-server/`:

```env
PORT=3001
RTMP_PORT=1935
DATABASE_URL=...
LIVEKIT_HTTP_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GLADIA_API_KEY=...
TRANSCRIPTION_JWT_SECRET=...
```


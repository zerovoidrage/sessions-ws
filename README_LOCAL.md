# Локальный запуск WS сервера

## ⚠️ Когда НУЖНО запускать локально:

**ТОЛЬКО** если вы разрабатываете или тестируете изменения в самом WS сервере:
- Отладка кода WS сервера
- Тестирование новых функций WS сервера
- Разработка RTMP функционала

## ⚠️ Когда НЕ нужно запускать локально:

- ✅ **Для разработки фронтенда** - используйте Railway WS сервер
- ✅ **Обычная разработка Next.js приложения** - подключитесь к Railway
- ✅ **Тестирование транскрипции** - используйте Railway сервер

**Для фронтенда настройте:**
```env
# .env.local
WS_SERVER_URL=https://sessions-ws-production.up.railway.app
NEXT_PUBLIC_WS_HOST=sessions-ws-production.up.railway.app
```

## Как запустить локально (если нужно):

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

- WS сервер - это отдельный репозиторий на GitHub
- Для деплоя используется Railway (автоматически при push в GitHub)
- В корне проекта `npm run dev` - это для Next.js фронтенда

## Переменные окружения

Создай файл `.env` в папке `ws-server/`:

```env
PORT=3001
RTMP_PORT=1936
DATABASE_URL=...
LIVEKIT_HTTP_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GLADIA_API_KEY=...
TRANSCRIPTION_JWT_SECRET=...
```


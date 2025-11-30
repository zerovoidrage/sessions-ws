# Быстрый деплой

## 1. WebSocket сервер на Railway

1. Зайди на [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Выбери репозиторий
3. Railway автоматически определит Node.js проект
4. Добавь переменные окружения:
   ```
   OPENAI_API_KEY=твой_ключ
   NODE_ENV=production
   ```
5. Railway автоматически присвоит домен типа `your-app.up.railway.app`
6. Скопируй этот домен

## 2. Next.js на Vercel

1. Зайди на [vercel.com](https://vercel.com) → Add New Project
2. Подключи GitHub репозиторий
3. Добавь Environment Variables:
   ```
   DATABASE_URL=твой_neon_url
   LIVEKIT_API_KEY=твой_ключ
   LIVEKIT_API_SECRET=твой_секрет
   NEXT_PUBLIC_LIVEKIT_URL=wss://твой_livekit_url
   OPENAI_API_KEY=твой_ключ
   NEXT_PUBLIC_WS_HOST=your-app.up.railway.app  # из шага 1
   NEXT_PUBLIC_WS_PORT=443
   ```
4. Deploy!

## 3. Проверка

- Открой Vercel URL
- Создай комнату
- Проверь DevTools → Network → WS
- Должно быть подключение к Railway домену

## Готово! 🎉




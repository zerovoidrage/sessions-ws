# Настройка переменных окружения в Vercel

## Переменные для WebSocket сервера транскрипции

### 1. NEXT_PUBLIC_WS_HOST

**Значение:** `sessions-ws.onrender.com`

⚠️ **Важно:**
- Только доменное имя, **БЕЗ** `https://`
- **БЕЗ** слеша в конце
- **БЕЗ** протокола

❌ **Неправильно:**
- `https://sessions-ws.onrender.com`
- `sessions-ws.onrender.com/`
- `wss://sessions-ws.onrender.com`

✅ **Правильно:**
- `sessions-ws.onrender.com`

### 2. NEXT_PUBLIC_WS_PORT

**Значение:** `10000` (или можно не указывать)

⚠️ **Важно:**
- Для production (HTTPS) код автоматически использует WSS на порту 443
- Порт указывается только для dev-окружения (localhost)
- Можно оставить пустым или установить для совместимости

### Как это работает:

1. В **production** (HTTPS):
   - Протокол: `wss://`
   - Порт: 443 (не указывается в URL)
   - URL: `wss://sessions-ws.onrender.com/api/realtime/transcribe?token=...`

2. В **development** (HTTP):
   - Протокол: `ws://`
   - Порт: из `NEXT_PUBLIC_WS_PORT` (по умолчанию 3001)
   - URL: `ws://localhost:3001/api/realtime/transcribe?token=...`

## Полный список переменных окружения

### Обязательные переменные:

1. **DATABASE_URL**
   - PostgreSQL connection string
   - Пример: `postgresql://user:password@host:5432/db?sslmode=require`

2. **NEXTAUTH_SECRET**
   - Секретный ключ для NextAuth.js
   - Генерация: `openssl rand -base64 32`

3. **NEXTAUTH_URL**
   - URL вашего приложения
   - Пример: `https://www.4sessions.space` (БЕЗ слеша в конце)

4. **GOOGLE_CLIENT_ID**
   - OAuth Client ID из Google Cloud Console

5. **GOOGLE_CLIENT_SECRET**
   - OAuth Client Secret из Google Cloud Console

6. **LIVEKIT_API_KEY**
   - API ключ от LiveKit

7. **LIVEKIT_API_SECRET**
   - API секрет от LiveKit

8. **NEXT_PUBLIC_LIVEKIT_URL**
   - URL LiveKit сервера
   - Пример: `wss://your-project.livekit.cloud`

9. **NEXT_PUBLIC_WS_HOST**
   - Хост WebSocket сервера транскрипции
   - Пример: `sessions-ws.onrender.com` (БЕЗ протокола)

10. **NEXT_PUBLIC_WS_PORT** (опционально)
    - Порт для dev-окружения
    - Значение: `10000` или можно не указывать

### Опциональные переменные:

- **OPENAI_API_KEY** (если используется OpenAI)
- **GLADIA_API_KEY** (если используется Gladia напрямую)

## Пример настройки в Vercel Dashboard

1. Перейдите в **Settings** → **Environment Variables**
2. Добавьте каждую переменную:
   - **Key:** имя переменной (например, `NEXT_PUBLIC_WS_HOST`)
   - **Value:** значение (например, `sessions-ws.onrender.com`)
   - **Environment:** выберите окружения (Production, Preview, Development)

3. После добавления всех переменных:
   - Нажмите **Save**
   - Пересоберите проект (Redeploy)

## Проверка настройки

После деплоя проверьте в браузере (DevTools → Console):

1. WebSocket подключение должно использовать `wss://` в production
2. Нет ошибок "Mixed Content"
3. Транскрипция работает корректно

## Troubleshooting

### Проблема: "Mixed Content" ошибка

**Причина:** Используется `ws://` вместо `wss://` в production

**Решение:**
- Убедитесь, что `NEXT_PUBLIC_WS_HOST` не содержит `https://`
- Убедитесь, что приложение работает по HTTPS
- Код автоматически определит использование WSS

### Проблема: WebSocket не подключается

**Проверьте:**
1. WebSocket сервер работает: `https://sessions-ws.onrender.com/health`
2. Переменная `NEXT_PUBLIC_WS_HOST` установлена правильно
3. Нет ошибок в консоли браузера
4. Firewall не блокирует соединение


# Настройка Vercel Deployment

## Переменные окружения

В Vercel нужно создать следующие Environment Variables / Secrets:

### 1. База данных
- **Name:** `database_url` (или `DATABASE_URL`)
- **Value:** PostgreSQL connection string (например, от Neon)
- **Пример:** `postgresql://user:password@host:5432/database?sslmode=require`

### 2. NextAuth
- **Name:** `NEXTAUTH_SECRET`
- **Value:** Секретный ключ для NextAuth (генерируется случайно)
- **Пример:** `openssl rand -base64 32`

- **Name:** `NEXTAUTH_URL`
- **Value:** URL вашего приложения на Vercel
- **Пример:** `https://your-project.vercel.app`

### 3. Google OAuth (если используется)
- **Name:** `GOOGLE_CLIENT_ID`
- **Value:** Google OAuth Client ID

- **Name:** `GOOGLE_CLIENT_SECRET`
- **Value:** Google OAuth Client Secret

### 4. LiveKit
- **Name:** `livekit_api_key`
- **Value:** API ключ LiveKit

- **Name:** `livekit_api_secret`
- **Value:** API секрет LiveKit

- **Name:** `next_public_livekit_url`
- **Value:** WebSocket URL LiveKit сервера
- **Пример:** `wss://your-project.livekit.cloud`

### 5. Gladia
- **Name:** `GLADIA_API_KEY`
- **Value:** API ключ Gladia для транскрипции

### 6. Cloudinary (если используется)
- **Name:** `CLOUDINARY_CLOUD_NAME`
- **Value:** Имя облака Cloudinary

- **Name:** `CLOUDINARY_API_KEY`
- **Value:** API ключ Cloudinary

- **Name:** `CLOUDINARY_API_SECRET`
- **Value:** API секрет Cloudinary

### 7. WebSocket Server
- **Name:** `next_public_ws_host`
- **Value:** Хост WebSocket сервера
- **Пример:** `ws.your-domain.com` или IP адрес

- **Name:** `next_public_ws_port`
- **Value:** Порт WebSocket сервера
- **Пример:** `443` (для wss://) или `3001`

### 8. OpenAI (если используется)
- **Name:** `openai_api_key`
- **Value:** API ключ OpenAI

## Как создать секреты в Vercel:

1. Откройте проект в Vercel Dashboard
2. Перейдите в **Settings** → **Environment Variables**
3. Для каждой переменной:
   - Нажмите **Add New**
   - Введите **Name** (например, `database_url`)
   - Введите **Value**
   - Выберите **Environment(s)** (Production, Preview, Development)
   - Нажмите **Save**

## Альтернативный подход:

Если не хотите использовать секреты через `@secret_name`, можно просто добавить переменные напрямую в Vercel, и они будут доступны автоматически. Тогда можно удалить `vercel.json` или изменить его, убрав секции `env`.


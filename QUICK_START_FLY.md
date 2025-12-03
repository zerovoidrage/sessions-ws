# Быстрый старт на Fly.io

## 1. Установка Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
# или
brew install flyctl
```

## 2. Авторизация

```bash
fly auth login
```

## 3. Создание приложения

```bash
cd ws-server
fly launch
```

**Выбери:**
- "No" на копирование конфигурации (у нас есть `fly.toml`)
- Регион (например, `iad`)
- Имя приложения (например, `sessions-ws-server`)

## 4. Установка переменных окружения

```bash
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set LIVEKIT_HTTP_URL="https://omni-pxx5e1ko.livekit.cloud"
fly secrets set LIVEKIT_API_KEY="APILED8W5B2vGjd"
fly secrets set LIVEKIT_API_SECRET="JKKrI04fCYpxGuyBASiglMSnupSe7a9hVowBlpE2Qp5"
fly secrets set GLADIA_API_KEY="aeb596f4-b70e-4d92-a3de-8084b24ebf90"
fly secrets set TRANSCRIPTION_JWT_SECRET="99b38577b08830fce2493607c263559b36696308fca91e01d3c3058cc3634d30"
fly secrets set RTMP_PORT="1937"
fly secrets set RTMP_INTERNAL_PORT="1937"
fly secrets set NODE_ENV="production"
```

## 5. Обновление fly.toml

Открой `fly.toml` и замени `app` и `primary_region` на выбранные значения при `fly launch`.

## 6. Деплой

```bash
fly deploy
```

## 7. Получение домена

После деплоя Fly.io создаст домен:
```
https://sessions-ws-server.fly.dev
```

## 8. Обновление фронтенда

В Vercel/Next.js переменные окружения:

```env
NEXT_PUBLIC_WS_HOST=sessions-ws-server.fly.dev
# NEXT_PUBLIC_WS_PORT - НЕ НУЖЕН (Fly.io использует стандартный 443)
```

## 9. Проверка

```bash
# Логи
fly logs

# Статус
fly status

# Метрики
fly metrics
```

## Готово! 🚀

WebSocket должен работать без ошибки 1006.


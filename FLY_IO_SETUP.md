# Миграция на Fly.io — пошаговая инструкция

## Почему Fly.io?

- ✅ **Отличная поддержка WebSocket** — нет проблем с 1006 closure
- ✅ **Кастомные TCP порты** — RTMP порт 1937 работает из коробки
- ✅ **Автоматическое определение хоста** — через `FLY_APP_NAME`
- ✅ **Простая конфигурация** — один файл `fly.toml`

---

## Шаг 1: Установка Fly CLI

```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Или через Homebrew (macOS)
brew install flyctl

# Проверка установки
fly version
```

---

## Шаг 2: Авторизация

```bash
fly auth login
```

Откроется браузер для авторизации через GitHub/GitLab.

---

## Шаг 3: Создание приложения

Перейди в директорию `ws-server`:

```bash
cd ws-server
fly launch
```

**При запуске `fly launch`:**
- Выбери **"No"** на вопрос "Do you want to copy your configuration file now?" (мы создадим свой)
- Выбери регион (например, `iad` для Washington D.C., `fra` для Frankfurt)
- Название приложения: например, `sessions-ws-server` или `sessions-ws`

---

## Шаг 4: Конфигурация fly.toml

После `fly launch` создастся `fly.toml`. Замени его содержимое на:

```toml
app = "sessions-ws-server"  # Замени на имя твоего приложения
primary_region = "iad"  # Замени на выбранный регион

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "3001"
  NODE_ENV = "production"

[[services]]
  internal_port = 3001
  protocol = "tcp"
  processes = ["app"]

  # HTTP/WebSocket через HTTPS
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
    force_https = true

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

# RTMP сервис на порту 1937 (TCP)
[[services]]
  internal_port = 1937
  protocol = "tcp"
  processes = ["app"]

  [[services.ports]]
    port = 1937
    handlers = ["tcp"]

# Health check
[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]
```

**Важно:**
- `internal_port = 3001` — порт, на котором слушает твой Node.js сервер
- Порт 443 (HTTPS) используется для WebSocket через `wss://`
- Порт 1937 (TCP) для RTMP потока
- Fly.io автоматически определяет домен: `sessions-ws-server.fly.dev`

---

## Шаг 5: Установка переменных окружения

Установи все необходимые переменные:

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

**ВАЖНО:** Fly.io автоматически устанавливает `FLY_APP_NAME`, поэтому `RTMP_HOST` не нужен — код сам определит домен через `${FLY_APP_NAME}.fly.dev`.

---

## Шаг 6: Деплой

```bash
fly deploy
```

После деплоя Fly.io создаст домен: `https://sessions-ws-server.fly.dev`

---

## Шаг 7: Проверка работы

### 7.1. Проверь логи

```bash
fly logs
```

Должно быть:
```
[WS-SERVER] ✅ WebSocket server running on port 3001
[RTMPServer] ✅ RTMP server started on port 1937
```

### 7.2. Проверь статус

```bash
fly status
```

### 7.3. Проверь WebSocket

Открой браузер DevTools → Network → WS и подключись к:
```
wss://sessions-ws-server.fly.dev/api/realtime/transcribe?token=...
```

Должно подключиться без ошибки `Invalid frame header`.

---

## Шаг 8: Обновление фронтенда

Обнови переменные окружения во фронтенде (Vercel или где деплоишь Next.js):

```env
NEXT_PUBLIC_WS_HOST=sessions-ws-server.fly.dev
NEXT_PUBLIC_WS_PORT=  # Пусто — не нужен для HTTPS
NEXT_PUBLIC_LIVEKIT_URL=wss://omni-pxx5e1ko.livekit.cloud
```

**ВАЖНО:** Для Fly.io используй `wss://` без порта (Fly.io автоматически проксирует 443).

---

## Шаг 9: Проверка RTMP

После деплоя получи домен RTMP:
```
rtmp://sessions-ws-server.fly.dev:1937/live/{sessionSlug}
```

Проверь в логах, что Egress подключается:
```
[RoomCompositeTranscriber] Egress streaming to: rtmp://sessions-ws-server.fly.dev:1937/live/...
[RTMPIngest] ✅ Stream started: /live/...
```

---

## Troubleshooting

### Проблема: WebSocket все еще закрывается с 1006

**Решение:** Проверь, что в `fly.toml` правильно настроен `internal_port = 3001` (тот же порт, на котором слушает Node.js).

### Проблема: RTMP не работает

**Решение:** 
1. Проверь, что RTMP сервис настроен в `fly.toml`
2. Проверь логи: `fly logs | grep RTMP`
3. Убедись, что порт 1937 открыт: `fly status` → проверь порты

### Проблема: Приложение не запускается

**Решение:**
```bash
# Проверь логи
fly logs

# Проверь статус
fly status

# Проверь конфигурацию
fly config validate
```

### Проблема: База данных не подключается

**Решение:** Проверь `DATABASE_URL`:
```bash
fly secrets list
```

Если нужно обновить:
```bash
fly secrets set DATABASE_URL="postgresql://..."
```

---

## Полезные команды

```bash
# Просмотр логов в реальном времени
fly logs

# SSH в контейнер
fly ssh console

# Проверка статуса
fly status

# Масштабирование (если нужно)
fly scale count 2

# Проверка метрик
fly metrics

# Перезапуск
fly apps restart sessions-ws-server
```

---

## Миграция с Railway

1. ✅ Деплой на Fly.io (см. выше)
2. ✅ Обновление переменных окружения фронтенда
3. ✅ Тестирование WebSocket и RTMP
4. ⏸️ После успешного теста можно отключить Railway сервис

**ВАЖНО:** Не удаляй Railway сразу — сначала убедись, что все работает на Fly.io!

---

## Стоимость

Fly.io бесплатный план включает:
- 3 shared-cpu-1x VMs
- 3 GB persistent volumes
- 160 GB outbound data transfer

Для WS-сервера этого должно быть достаточно для старта.

---

## Следующие шаги

После успешной миграции:
1. ✅ Обнови `.cursorrules` с информацией о Fly.io
2. ✅ Обнови документацию в `docs/`
3. ✅ Обнови переменные окружения фронтенда


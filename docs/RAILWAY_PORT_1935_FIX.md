# Исправление проблемы PORT=1935 в Railway

## Проблема

При деплое WebSocket сервера на Railway вы видите предупреждения:

```
[WS-SERVER] ⚠️ PORT=1935 (RTMP port). HTTP/WebSocket server will listen on this port.
[WS-SERVER] ⚠️ RTMP server will not be able to start on port 1935.
[WS-SERVER] ⚠️ Skipping RTMP server startup: PORT=1935 (HTTP/WebSocket server is already using this port)
```

**Причина:** Railway настроил HTTP/WebSocket сервер на порту 1935, который должен использоваться только для RTMP.

---

## Решение

### 1. Исправить настройки Railway Networking

#### Шаг 1: Откройте настройки сервиса
1. Зайдите в Railway → Ваш проект → Ваш сервис (`sessions-ws`)
2. Перейдите во вкладку **"Settings"** (шестерёнка вверху)
3. Найдите секцию **"Networking"** или **"Public Networking"**

#### Шаг 2: Измените порт для HTTP/WebSocket
Найдите секцию с вашим доменом (например, `sessions-ws-production.up.railway.app`):

```
sessions-ws-production.up.railway.app
Port 1935 ▼  ← ЭТО НУЖНО ИЗМЕНИТЬ
```

1. Нажмите на выпадающий список **"Port 1935"**
2. Выберите **"DEFAULT"** или **"Auto-detect"**
   - ❌ **НЕ оставляйте** 1935, 8000, 5000 или любой другой конкретный порт
   - ✅ Выберите **"DEFAULT"** или **"Auto-detect"**
3. Сохраните изменения

#### Шаг 3: Добавьте TCP-прокси для RTMP
1. В той же секции **"Networking"** нажмите **"Add Port"** или **"New Port"**
2. Настройте:
   - **Port:** `1935`
   - **Protocol:** `TCP`
   - **Type:** `Public`
3. Сохраните

Railway автоматически создаст публичный URL для RTMP (например, `switchyard.proxy.rlwy.net:47848`).

---

### 2. Проверьте переменные окружения

#### Удалите (если есть):
- ❌ `PORT=1935` - **удалите эту переменную!**
- ❌ `PORT=8000` - **удалите!**
- ❌ `WS_PORT=...` - **удалите!**

Railway **сам** установит правильный `PORT` (например, 42577).

#### Оставьте/добавьте:
```env
# ✅ Эти переменные должны быть:

# RTMP (внутренний порт, на котором RTMP сервер слушает внутри контейнера)
RTMP_PORT=1935

# RTMP Host (внешний домен для подключения извне)
# Используйте домен из TCP Access в Railway Networking
RTMP_HOST=switchyard.proxy.rlwy.net

# Другие обязательные переменные:
LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GLADIA_API_KEY=...
DATABASE_URL=...
TRANSCRIPTION_JWT_SECRET=...
```

**Важно:** 
- `RTMP_HOST` должен быть доменом из **TCP Access** в Railway (например, `switchyard.proxy.rlwy.net`)
- **НЕ** используйте домен из Public Networking (например, `sessions-ws-production.up.railway.app`) для RTMP
- **НЕ** добавляйте протокол (`rtmp://`) или порт в `RTMP_HOST`

---

### 3. Перезапустите сервис

После изменения настроек Railway автоматически перезапустит сервис. Если нет - перезапустите вручную:

1. Railway → Ваш сервис → **"Deployments"**
2. Найдите последний деплой
3. Нажмите **"Redeploy"** или три точки → **"Restart"**

---

### 4. Проверьте логи

После перезапуска проверьте логи Railway:

**✅ Правильные логи (что должно быть):**

```
[WS-SERVER] ✅ WebSocket server running on port 42577
[WS-SERVER] Metrics endpoint: http://localhost:42577/metrics
[WS-SERVER] Health check: http://localhost:42577/health
[WS-SERVER] WebSocket endpoint: ws://localhost:42577/api/realtime/transcribe
[RTMPServer] ✅ RTMP server started on port 1935
[WS-SERVER] ✅ RTMP server started for Room Composite Egress
```

**Примечание:** Порт может быть любым (42577, 54321, и т.д.) - это нормально, Railway сам выбирает порт.

**❌ Неправильные логи (чего НЕ должно быть):**

```
[WS-SERVER] ⚠️ PORT=1935 (RTMP port)...
[WS-SERVER] ⚠️ Skipping RTMP server startup...
```

Если вы видите эти предупреждения, вернитесь к шагу 1 и убедитесь, что порт в Public Networking установлен на "DEFAULT".

---

## Итоговая конфигурация Railway

### Settings → Networking

```
Public Networking:
  sessions-ws-production.up.railway.app
  Port: DEFAULT (или Auto-detect)  ✅

TCP Access (или Private Networking):
  Port: 1935
  Protocol: TCP
  Type: Public
  Domain: switchyard.proxy.rlwy.net:47848  ✅
```

### Settings → Variables

```env
# ❌ НЕ ДОЛЖНО БЫТЬ:
# PORT=...

# ✅ ДОЛЖНО БЫТЬ:
RTMP_PORT=1935
RTMP_HOST=switchyard.proxy.rlwy.net
LIVEKIT_HTTP_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GLADIA_API_KEY=...
DATABASE_URL=...
TRANSCRIPTION_JWT_SECRET=...
```

---

## Как это работает

1. **HTTP/WebSocket сервер:**
   - Railway автоматически устанавливает `PORT` (например, 42577) внутри контейнера
   - Ваш сервер читает `process.env.PORT` и слушает на этом порту
   - Railway проксирует внешний HTTPS (443) → внутренний PORT (42577)
   - WebSocket upgrade работает корректно

2. **RTMP сервер:**
   - RTMP сервер слушает на порту 1935 внутри контейнера
   - Railway TCP-прокси перенаправляет внешний TCP порт → внутренний порт 1935
   - LiveKit Egress подключается к `rtmp://switchyard.proxy.rlwy.net:47848/live/SESSION_SLUG`

3. **Разделение портов:**
   - HTTP/WebSocket: динамический порт от Railway (через Public Networking с DEFAULT)
   - RTMP: статический порт 1935 (через TCP Access)

---

## Troubleshooting

### Проблема: Предупреждения всё ещё появляются

**Решение:**
1. Убедитесь, что в Railway Variables **НЕТ** переменной `PORT`
2. Убедитесь, что в Railway Networking → Public Networking порт установлен на **"DEFAULT"** (не 1935)
3. Перезапустите сервис

### Проблема: RTMP сервер не запускается

**Решение:**
1. Проверьте, что `RTMP_PORT=1935` установлен в Variables
2. Проверьте логи на ошибки запуска RTMP сервера
3. Убедитесь, что порт 1935 не используется другим процессом

### Проблема: WebSocket не работает

**Решение:**
1. Проверьте, что порт в Public Networking установлен на **"DEFAULT"**
2. Проверьте логи - сервер должен запуститься без предупреждений
3. Проверьте доступность: `curl https://your-app.up.railway.app/health`

---

**Последнее обновление:** 2025-12-02


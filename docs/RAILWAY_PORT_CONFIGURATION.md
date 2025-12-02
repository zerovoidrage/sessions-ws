# Настройка портов в Railway

**⚠️ КРИТИЧЕСКИ ВАЖНО:** Railway автоматически управляет портами. НЕ устанавливайте PORT вручную!

---

## ❌ ЧТО НЕ НУЖНО ДЕЛАТЬ

### 1. НЕ устанавливайте PORT в переменных окружения

```env
# ❌ УДАЛИТЕ ЭТИ ПЕРЕМЕННЫЕ, ЕСЛИ ОНИ ЕСТЬ:
PORT=8000
WS_PORT=8000
PORT=3001
WS_PORT=3001
```

**Почему:**
- Railway САМ подставит верный PORT внутрь контейнера
- Если вы установите PORT вручную, это может конфликтовать с настройками Railway
- Railway использует свой внутренний порт, который может отличаться от того, что вы указали

---

## ✅ ЧТО НУЖНО ДЕЛАТЬ

### 1. Код должен читать process.env.PORT

**Правильный код в `ws-server/server/index.ts`:**

```typescript
// Railway автоматически устанавливает PORT
// Fallback на 3001 только для локальной разработки
const port = Number(process.env.PORT) || 3001

server.listen(port, () => {
  console.log("✅ WS server running on port", port)
})
```

**Важно:**
- Используйте `Number(process.env.PORT) || 3001`
- Fallback на 3001 только для локальной разработки
- В Railway `process.env.PORT` всегда будет установлен

### 2. Настройки Railway Networking

**Шаги:**

1. Перейдите в **Railway → Ваш сервис → Settings → Public Networking**
2. Найдите секцию с вашим доменом:
   ```
   sessions-ws-production.up.railway.app
   Port 8000 ▼  ← ЭТО НУЖНО ИЗМЕНИТЬ
   ```
3. Нажмите на выпадающий список **"Port 8000"** (или текущий порт)
4. Выберите **"DEFAULT"** или **"Auto-detect"** (зависит от UI Railway)
   - ❌ НЕ оставляйте 8000, 5000, 3001 или любой другой конкретный порт
   - ✅ Выберите "DEFAULT" или "Auto-detect"
5. Сохраните изменения

**Как это работает:**
- Railway автоматически определяет, на каком порту слушает ваше приложение (через `process.env.PORT`)
- Railway устанавливает `process.env.PORT` внутри контейнера (например, 42577)
- Ваш сервер читает `process.env.PORT` и слушает на этом порту
- Railway проксирует внешний HTTPS (443) → внутренний PORT (например, 42577)
- Railway корректно выполняет WebSocket upgrade
- Вам НЕ нужно знать, какой именно порт использует Railway внутри

---

## Проверка конфигурации

### 1. Проверьте переменные окружения в Railway

**В Railway → Ваш сервис → Variables:**

- ✅ НЕ должно быть `PORT` или `WS_PORT`
- ✅ Должны быть только: `LIVEKIT_HTTP_URL`, `LIVEKIT_API_KEY`, `GLADIA_API_KEY`, `DATABASE_URL`, `TRANSCRIPTION_JWT_SECRET`, `RTMP_PORT`, `RTMP_HOST`

### 2. Проверьте настройки Networking

**В Railway → Ваш сервис → Settings → Public Networking:**

- ✅ Port: "DEFAULT" или "Auto-detect"
- ❌ НЕ должно быть: 8000, 5000, 3001 или любой другой конкретный порт
- ✅ Домен: `sessions-ws-production.up.railway.app`

### 3. Проверьте логи Railway

**После деплоя проверьте логи:**

```
[WS-SERVER] ✅ WebSocket server running on port 12345
```

**Важно:**
- Порт может быть любым (12345, 54321, и т.д.)
- Это нормально - Railway сам выбирает порт
- Главное - сервер должен запуститься без ошибок

### 4. Проверьте доступность

**HTTP эндпоинты должны работать:**

```bash
curl https://sessions-ws-production.up.railway.app/health
# Ожидаемый ответ: {"status":"ok",...}
```

**WebSocket должен работать:**

```bash
npx wscat -c "wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=TEST"
# Ожидаемое поведение: подключение устанавливается (может закрыться из-за невалидного токена - это нормально)
```

---

## Частые ошибки

### Ошибка: "Port 8000" в Public Networking

**Проблема:**
В Railway Settings → Public Networking установлен Port = 8000 (или другой конкретный порт)

**Решение:**
1. Перейдите в Railway → Ваш сервис → Settings → Public Networking
2. Найдите секцию с доменом `sessions-ws-production.up.railway.app`
3. Нажмите на выпадающий список "Port 8000"
4. Выберите "DEFAULT" или "Auto-detect"
5. Сохраните изменения
6. Railway автоматически перезапустит сервис
7. Railway установит правильный PORT (например, 42577) и проксирует WebSocket корректно

### Ошибка: "Port already in use"

**Проблема:**
В переменных окружения установлен PORT, который конфликтует с Railway

**Решение:**
1. Удалите переменную `PORT` из Railway Variables
2. Удалите переменную `WS_PORT` из Railway Variables
3. Railway автоматически установит правильный PORT

### Ошибка: "Invalid frame header" при WebSocket подключении

**Проблема:**
Target Port настроен неправильно, Railway не может проксировать WebSocket

**Решение:**
1. Установите Target Port на "Default" или "Auto"
2. Убедитесь, что в коде используется `process.env.PORT`
3. Перезапустите сервис

---

## Итоговая конфигурация

### Railway Variables (что должно быть)

```env
# ❌ НЕ ДОЛЖНО БЫТЬ:
# PORT=...
# WS_PORT=...

# ✅ ДОЛЖНО БЫТЬ:
LIVEKIT_HTTP_URL=https://omni-pxx5e1ko.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GLADIA_API_KEY=...
DATABASE_URL=...
TRANSCRIPTION_JWT_SECRET=...
RTMP_PORT=1935
RTMP_HOST=sessions-ws-production.up.railway.app
```

### Railway Networking Settings

```
Public Networking:
  sessions-ws-production.up.railway.app
  Port: DEFAULT (или Auto-detect)
  ❌ НЕ: 8000, 5000, 3001 или любой другой конкретный порт
```

**После исправления:**
- Railway автоматически установит PORT (например, 42577)
- Ваш сервер начнёт слушать этот порт
- Railway будет выполнять WebSocket upgrade корректно

### Код (`ws-server/server/index.ts`)

```typescript
const port = Number(process.env.PORT) || 3001
server.listen(port, () => {
  console.log("✅ WS server running on port", port)
})
```

---

**Последнее обновление:** 2024-12-28


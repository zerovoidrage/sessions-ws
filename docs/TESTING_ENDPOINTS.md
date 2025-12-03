# Тестирование эндпоинтов WebSocket сервера

## Автоматическое тестирование

### Локальное тестирование

1. **Запустите сервер:**
   ```bash
   cd ws-server
   npm run dev
   ```

2. **В другом терминале запустите тесты:**
   ```bash
   cd ws-server
   npm run test:endpoints
   ```

3. **Или с кастомным URL:**
   ```bash
   BASE_URL=http://localhost:3001 npm run test:endpoints
   ```

### Тестирование на Railway (production)

```bash
BASE_URL=https://sessions-ws-production.up.railway.app \
TRANSCRIPTION_JWT_SECRET=your_secret_here \
npm run test:endpoints
```

## Ручное тестирование с curl

### 1. Health Check

```bash
curl -X GET http://localhost:3001/health
```

**Ожидаемый ответ:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-02T...",
  "queueLength": 0
}
```

### 2. Metrics

```bash
curl -X GET http://localhost:3001/metrics
```

**Ожидаемый ответ:**
```json
{
  "connections": 0,
  "gladiaBridges": 0,
  "messagesReceived": 0,
  "messagesSent": 0,
  "errors": [],
  "queue": {
    "queueLength": 0,
    "totalQueued": 0,
    "totalFlushed": 0
  }
}
```

### 3. Active Speaker (с валидным токеном)

**Сначала создайте тестовый токен:**

```bash
# Установите TRANSCRIPTION_JWT_SECRET
export TRANSCRIPTION_JWT_SECRET="your-secret-here"

# Создайте токен с помощью Node.js
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({
  sub: 'test-user',
  sessionId: 'test-session-123',
  sessionSlug: 'test-room',
  identity: 'test-user:test-session-123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
}, process.env.TRANSCRIPTION_JWT_SECRET, { algorithm: 'HS256' });
console.log(token);
"
```

**Затем отправьте запрос:**

```bash
curl -X POST http://localhost:3001/api/active-speaker \
  -H "Content-Type: application/json" \
  -d '{
    "sessionSlug": "test-room",
    "identity": "test-user:test-session-123",
    "name": "Test User",
    "timestamp": 1733107200000,
    "token": "YOUR_TOKEN_HERE"
  }'
```

**Ожидаемый ответ:**
```json
{
  "success": true
}
```

### 4. Active Speaker (с невалидным токеном)

```bash
curl -X POST http://localhost:3001/api/active-speaker \
  -H "Content-Type: application/json" \
  -d '{
    "sessionSlug": "test-room",
    "identity": "test-user:test-session-123",
    "name": "Test User",
    "timestamp": 1733107200000,
    "token": "invalid-token"
  }'
```

**Ожидаемый ответ:**
```json
{
  "error": "Invalid or expired transcription token"
}
```

**Статус код:** 401

### 5. Active Speaker (без обязательных полей)

```bash
curl -X POST http://localhost:3001/api/active-speaker \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User"
  }'
```

**Ожидаемый ответ:**
```json
{
  "error": "Missing required fields: sessionSlug, identity, token"
}
```

**Статус код:** 400

### 6. Transcription Start (требует валидные данные)

```bash
curl -X POST http://localhost:3001/api/transcription/start \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-123",
    "sessionSlug": "test-room"
  }'
```

**Ожидаемый ответ:**
```json
{
  "success": true,
  "sessionId": "test-session-123",
  "message": "Transcription start initiated"
}
```

## Тестирование на Railway (production)

Замените `http://localhost:3001` на ваш Railway URL:

```bash
# Пример для Railway
BASE_URL=https://sessions-ws-production.up.railway.app
curl -X GET $BASE_URL/health
curl -X GET $BASE_URL/metrics
```

## Проверка работы после изменений

После изменения эндпоинтов рекомендуется протестировать:

1. ✅ Health check работает
2. ✅ Metrics возвращает данные
3. ✅ Active speaker принимает валидный токен
4. ✅ Active speaker отклоняет невалидный токен
5. ✅ Active speaker валидирует обязательные поля

## Переменные окружения для тестирования

```bash
# Локальное тестирование
BASE_URL=http://localhost:3001
TRANSCRIPTION_JWT_SECRET=your-secret-here

# Railway тестирование
BASE_URL=https://sessions-ws-production.up.railway.app
TRANSCRIPTION_JWT_SECRET=your-production-secret-here
```



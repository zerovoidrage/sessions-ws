# Как получить transcription token для тестирования

Токен нужен для подключения к WebSocket через `wscat` или другие инструменты.

---

## Способ 1: Из браузерной консоли (самый простой)

### Шаги:

1. **Откройте сессию в браузере:**
   - Перейдите на `http://localhost:3000/session/ВАШ_SLUG`
   - Или на production URL

2. **Откройте DevTools (F12) → Console**

3. **Выполните команду:**
   ```javascript
   // Получаем токен из localStorage или из переменной, если она доступна
   // Или делаем запрос к API
   fetch('/api/sessions/ВАШ_SLUG/token?name=TestUser')
     .then(r => r.json())
     .then(data => console.log('Transcription Token:', data.transcriptionToken))
   ```

4. **Скопируйте токен из консоли**

---

## Способ 2: Из Network tab в DevTools

### Шаги:

1. **Откройте сессию в браузере**

2. **Откройте DevTools (F12) → Network**

3. **Найдите запрос:**
   ```
   GET /api/sessions/[slug]/token?name=...
   ```

4. **Откройте Response → найдите поле `transcriptionToken`**

5. **Скопируйте значение токена**

---

## Способ 3: Через curl (для локальной разработки)

### Шаги:

```bash
# Замените YOUR_SLUG на slug вашей сессии
curl "http://localhost:3000/api/sessions/YOUR_SLUG/token?name=TestUser" | jq -r '.transcriptionToken'
```

**Или без jq:**

```bash
curl "http://localhost:3000/api/sessions/YOUR_SLUG/token?name=TestUser"
# Скопируйте transcriptionToken из JSON ответа
```

**Для production:**

```bash
curl "https://your-domain.vercel.app/api/sessions/YOUR_SLUG/token?name=TestUser" | jq -r '.transcriptionToken'
```

---

## Способ 4: Из кода (для автоматизации)

### Пример:

```typescript
// Получаем токен через API
const response = await fetch(`/api/sessions/${sessionSlug}/token?name=TestUser`)
const data = await response.json()
const transcriptionToken = data.transcriptionToken

// Используем токен
const ws = new WebSocket(`wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=${transcriptionToken}`)
```

---

## Использование токена с wscat

### После получения токена:

```bash
# Замените YOUR_TOKEN на полученный токен
npx wscat -c "wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=YOUR_TOKEN"
```

### Что должно произойти:

- ✅ Подключение устанавливается
- ✅ Сервер может закрыть соединение из-за невалидного токена (если токен истёк или невалидный)
- ❌ НЕ должно быть ошибки "Invalid frame header" (это означает проблему на сервере)

---

## Важные замечания

### Токен истекает через 1 час

Токен имеет срок действия 1 час (`expiresIn: 3600`). Если токен истёк:
- Получите новый токен через API
- Или перезагрузите страницу сессии

### Токен привязан к сессии

Токен содержит:
- `sessionSlug` - slug сессии
- `sessionId` - ID сессии из БД
- `identity` - LiveKit identity участника

Токен от одной сессии не будет работать для другой сессии.

### Токен требует авторизации (для некоторых сессий)

Если сессия требует авторизации:
- Нужно быть авторизованным пользователем
- Или использовать guest identity

---

## Пример полного процесса

```bash
# 1. Получаем токен
TOKEN=$(curl -s "http://localhost:3000/api/sessions/YOUR_SLUG/token?name=TestUser" | jq -r '.transcriptionToken')

# 2. Проверяем, что токен получен
echo "Token: $TOKEN"

# 3. Подключаемся через wscat
npx wscat -c "wss://sessions-ws-production.up.railway.app/api/realtime/transcribe?token=$TOKEN"
```

---

## Troubleshooting

### Ошибка: "Session not found"

**Причина:** Неправильный slug сессии

**Решение:** Проверьте, что сессия существует и slug правильный

### Ошибка: "Session has ended"

**Причина:** Сессия завершена или истекла

**Решение:** Создайте новую сессию или используйте активную сессию

### Ошибка: "Invalid or expired transcription token"

**Причина:** Токен истёк или невалидный

**Решение:** Получите новый токен

### Ошибка: "Invalid frame header"

**Причина:** Проблема на сервере (не связана с токеном)

**Решение:** Проверьте логи Railway, настройки проксирования

---

**Последнее обновление:** 2024-12-28


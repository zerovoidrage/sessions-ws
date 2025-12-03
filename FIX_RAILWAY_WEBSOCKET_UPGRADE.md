# Fix: Railway WebSocket "Invalid frame header" Issue

## Проблема

WebSocket подключается (`Connected successfully`), но сразу падает с ошибкой:
```
WebSocket connection to 'wss://sessions-ws-production.up.railway.app/...' failed: Invalid frame header
```

Railway логи показывают:
```
[WS-SERVER] ✅ WebSocket connection established
[WS-SERVER] Client connected
[WS-SERVER] Client authenticated
[WS-SERVER] Client disconnected  <-- падает сразу после аутентификации
```

## Причина

Railway Proxy буферизирует WebSocket upgrade response и может задерживать передачу первого фрейма. Если сервер отправляет `ws.send()` сразу после аутентификации (до завершения upgrade на стороне Proxy), клиент получает некорректный фрейм.

## Решение

Добавлена задержка 100ms перед отправкой первого сообщения клиенту. Это даёт Railway Proxy время завершить WebSocket upgrade перед отправкой данных.

**Изменённый файл:** `ws-server/server/client-connection.ts`

```typescript
// Отправляем initial message клиенту, чтобы подтвердить успешное подключение
// ВАЖНО: Добавляем небольшую задержку для Railway Proxy (даём время завершить WebSocket upgrade)
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: 'connected',
        sessionSlug,
        message: 'WebSocket connection established',
      }))
    } catch (error) {
      console.error('[WS-SERVER] Failed to send initial message:', error)
    }
  }
}, 100) // 100ms задержка для Railway Proxy
```

## Push на GitHub

```bash
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server
git add server/client-connection.ts
git commit -m "fix: add 100ms delay before sending first WS message for Railway Proxy compatibility"
git push origin main
```

## После Push

1. Railway автоматически задеплоит изменения
2. Подождите 1-2 минуты
3. Обновите страницу с сессией
4. WebSocket должен подключиться без ошибок

## Что должно работать

- WebSocket подключается
- Клиент получает сообщение `{ type: 'connected' }`
- Соединение остаётся активным
- Транскрипты начинают приходить


# Исправление проблемы с портами в Railway

## Проблема

Railway Public Networking проксирует HTTP запросы на порт **8000**, но сервер слушает на порту **3001** (или значение из `PORT`).

## Решение

### Вариант 1: Установить PORT=8000 в Railway Variables (РЕКОМЕНДУЕТСЯ)

1. Зайдите в Railway → ваш сервис → **Variables**
2. Добавьте или измените переменную:
   ```env
   PORT=8000
   ```
3. Railway автоматически перезапустит сервис
4. Сервер будет слушать на порту 8000, что соответствует настройкам Public Networking

### Вариант 2: Изменить порт в Public Networking на 3001

1. Зайдите в Railway → ваш сервис → **Settings** → **Networking**
2. В разделе **Public Networking** измените порт с `8000` на `3001`
3. Нажмите **Update**

## Проверка

После применения изменений:

1. Проверьте логи Railway - должно быть:
   ```
   [WS-SERVER] WebSocket server listening on port 8000
   ```

2. Проверьте тестовый endpoint:
   ```bash
   curl https://sessions-ws-production.up.railway.app/test
   ```

3. Должен вернуться JSON с `status: 'ok'`

## Текущие настройки

- **Public Networking**: порт 8000 → `sessions-ws-production.up.railway.app`
- **TCP Proxy**: порт 47848 → 1935 (для RTMP)
- **Сервер должен слушать**: порт 8000 (если установлен `PORT=8000`)


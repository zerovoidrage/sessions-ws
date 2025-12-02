# Пошаговая настройка Railway для WebSocket + RTMP сервера

## 1. Создание проекта и подключение репозитория

1. Зайдите на https://railway.app
2. Создайте новый проект: **"New Project"**
3. Выберите **"Deploy from GitHub repo"**
4. Найдите и выберите `zerovoidrage/sessions-ws`
5. Railway автоматически начнет деплой

## 2. Настройка портов (TCP-прокси для RTMP)

### Где добавить порт 1935:

1. **В проекте Railway** откройте ваш сервис (сервис с именем `sessions-ws`)
2. Перейдите во вкладку **"Settings"** (шестеренка вверху)
3. Прокрутите до секции **"Networking"**
4. Нажмите **"Add Port"** или **"New Port"**
5. Настройте:
   - **Port:** `1935`
   - **Protocol:** `TCP`
   - **Type:** `Public` (чтобы был доступен извне)
6. Сохраните

Railway автоматически создаст публичный URL для RTMP (например, `tcp://your-app.up.railway.app:1935`)

### Где посмотреть RTMP URL:

После добавления порта, в секции **"Networking"** будет показан публичный URL для TCP-прокси. Используйте этот URL в переменных окружения.

## 3. Переменные окружения

### Где добавить переменные:

1. В проекте Railway откройте ваш сервис
2. Перейдите во вкладку **"Variables"** (или **"Settings"** → **"Variables"**)
3. Нажмите **"New Variable"** для каждой переменной

### Список переменных:

```env
# Порт WebSocket сервера (Railway автоматически устанавливает PORT)
PORT=3001

# RTMP сервер
RTMP_PORT=1935
RTMP_HOST=your-app.up.railway.app  # Замените на ваш Railway домен (из Networking)

# LiveKit
LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# Gladia
GLADIA_API_KEY=your_gladia_api_key

# База данных (если используется)
DATABASE_URL=your_database_url

# Node окружение
NODE_ENV=production
```

### Как получить RTMP_HOST:

1. После добавления TCP-прокси для порта 1935
2. В секции **"Networking"** найдите созданный TCP-прокси
3. Скопируйте домен (например, `your-app.up.railway.app`)
4. Используйте его в `RTMP_HOST`

**ВАЖНО:** Не добавляйте порт в `RTMP_HOST`! Используйте только домен:
- ✅ Правильно: `RTMP_HOST=your-app.up.railway.app`
- ❌ Неправильно: `RTMP_HOST=your-app.up.railway.app:1935`

## 4. Настройка команды запуска (если нужно)

Railway автоматически определит команду запуска из `package.json`, но можно указать вручную:

1. В **"Settings"** → **"Deploy"**
2. **Start Command:** `npm run dev:ws` (для разработки) или `npm start` (для production)

### Рекомендуется создать `Procfile` или обновить `package.json`:

```json
{
  "scripts": {
    "start": "tsx ws/server/index.ts",
    "dev:ws": "tsx ws/server/index.ts"
  }
}
```

## 5. Проверка работы

### После деплоя проверьте:

1. **Логи Railway:**
   - Вкладка **"Deployments"** → выберите последний деплой → **"View Logs"**
   - Должно быть:
     ```
     [WS-SERVER] WebSocket server listening on port 3001
     [RTMPServer] ✅ RTMP server started on port 1935
     ```

2. **Health check:**
   - Откройте: `https://your-app.up.railway.app/health`
   - Должен вернуть: `{"status":"ok"}`

3. **RTMP порт:**
   - Проверьте, что TCP-прокси создан в **"Networking"**
   - URL должен быть доступен извне

## 6. Troubleshooting

### Порт 1935 не работает:

1. Проверьте, что TCP-прокси добавлен в **"Networking"**
2. Убедитесь, что `RTMP_PORT=1935` установлен
3. Проверьте логи на ошибки

### RTMP_HOST неправильный:

1. Используйте домен из **"Networking"** → TCP-прокси
2. Не добавляйте порт в `RTMP_HOST`
3. Проверьте, что домен правильный (без `http://` или `rtmp://`)

### WebSocket сервер не запускается:

1. Проверьте переменную `PORT` (должна быть `3001`)
2. Проверьте логи на ошибки
3. Убедитесь, что все зависимости установлены

## 7. Пример полной конфигурации

```
Проект: sessions-ws
├── Сервис: sessions-ws
│   ├── Settings
│   │   ├── Networking
│   │   │   ├── Port 3001 (HTTP/WebSocket) - автоматически
│   │   │   └── Port 1935 (TCP/RTMP) - добавить вручную
│   │   └── Variables
│   │       ├── PORT=3001
│   │       ├── RTMP_PORT=1935
│   │       ├── RTMP_HOST=your-app.up.railway.app
│   │       ├── LIVEKIT_HTTP_URL=...
│   │       ├── LIVEKIT_API_KEY=...
│   │       ├── LIVEKIT_API_SECRET=...
│   │       └── GLADIA_API_KEY=...
│   └── Deployments
│       └── Логи деплоя
```

## 8. После настройки

После того как все настроено:

1. Railway автоматически задеплоит при push в `main`
2. Проверьте логи первого деплоя
3. Убедитесь, что оба сервера запущены (WebSocket и RTMP)
4. Обновите переменные в основном проекте (Vercel), чтобы они указывали на Railway домен


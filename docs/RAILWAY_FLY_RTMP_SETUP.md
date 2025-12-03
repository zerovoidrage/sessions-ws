# Настройка RTMP для Railway.app и Fly.io

## Преимущества перед Render

✅ **Railway и Fly.io поддерживают кастомные TCP порты** (включая RTMP порт 1935)
- Не нужен ngrok или отдельный VPS
- Прямая поддержка RTMP из коробки
- Стабильнее и проще в настройке

## Railway.app

### Настройка RTMP порта

Railway поддерживает кастомные порты через TCP-прокси.

#### Шаги:

1. **Создайте новый проект на Railway:**
   - Зайдите на https://railway.app
   - Создайте новый проект
   - Подключите ваш репозиторий

2. **Добавьте сервис:**
   - Выберите "New Service" → "GitHub Repo"
   - Выберите ваш репозиторий

3. **Настройте переменные окружения:**
   ```env
   PORT=3001  # WebSocket сервер
   RTMP_PORT=1935  # RTMP сервер
   RTMP_HOST=your-railway-domain.up.railway.app  # Автоматически генерируется Railway
   
   # LiveKit
   LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   
   # Gladia
   GLADIA_API_KEY=your_gladia_key
   ```

4. **Настройте TCP-прокси для RTMP:**
   - В настройках сервиса найдите "Networking"
   - Добавьте TCP-прокси для порта 1935
   - Railway автоматически создаст публичный URL

5. **Обновите код для использования Railway домена:**
   ```typescript
   // В livekit-room-composite-transcriber.ts
   // Railway автоматически предоставляет домен через переменную окружения
   const rtmpHost = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RTMP_HOST || 'localhost'
   ```

6. **Деплой:**
   ```bash
   # Railway автоматически деплоит при push в репозиторий
   git push origin main
   ```

#### Получение RTMP URL

Railway предоставляет публичный домен через переменную окружения `RAILWAY_PUBLIC_DOMAIN` или через TCP-прокси.

**Вариант 1: Использовать Railway домен**
```env
RTMP_HOST=your-service.up.railway.app
RTMP_PORT=1935
```

**Вариант 2: Использовать TCP-прокси (рекомендуется)**
- Railway создаст отдельный URL для TCP-прокси
- Используйте этот URL в `RTMP_HOST`

#### Проверка работы

1. **Проверьте логи Railway:**
   ```
   [RTMPServer] ✅ RTMP server started on port 1935
   ```

2. **Проверьте TCP-прокси:**
   - В настройках сервиса → Networking → TCP Proxy
   - Должен быть создан публичный URL

3. **Проверьте подключение:**
   ```bash
   telnet your-rtmp-host.up.railway.app 1935
   ```

---

## Fly.io

### Настройка RTMP порта

Fly.io поддерживает кастомные порты через конфигурацию `fly.toml`.

#### Шаги:

1. **Установите Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Авторизуйтесь:**
   ```bash
   fly auth login
   ```

3. **Создайте приложение:**
   ```bash
   fly launch
   ```

4. **Создайте `fly.toml` в корне проекта:**
   ```toml
   app = "your-app-name"
   primary_region = "iad"  # Выберите регион

   [build]
     builder = "paketobuildpacks/builder:base"

   [env]
     PORT = "3001"
     RTMP_PORT = "1935"

   [[services]]
     internal_port = 3001
     protocol = "tcp"
     processes = ["app"]

     [[services.ports]]
       port = 3001
       handlers = ["tls", "http"]
       force_https = true

     [[services.ports]]
       port = 80
       handlers = ["http"]
       force_https = true

   # RTMP сервис на порту 1935
   [[services]]
     internal_port = 1935
     protocol = "tcp"
     processes = ["app"]

     [[services.ports]]
       port = 1935
       handlers = ["tcp"]
   ```

5. **Настройте переменные окружения:**
   ```bash
   fly secrets set LIVEKIT_HTTP_URL=https://your-project.livekit.cloud
   fly secrets set LIVEKIT_API_KEY=your_api_key
   fly secrets set LIVEKIT_API_SECRET=your_api_secret
   fly secrets set GLADIA_API_KEY=your_gladia_key
   fly secrets set RTMP_HOST=your-app-name.fly.dev
   fly secrets set RTMP_PORT=1935
   ```

6. **Деплой:**
   ```bash
   fly deploy
   ```

#### Получение RTMP URL

Fly.io автоматически создает публичный домен: `your-app-name.fly.dev`

```env
RTMP_HOST=your-app-name.fly.dev
RTMP_PORT=1935
```

#### Проверка работы

1. **Проверьте логи Fly.io:**
   ```bash
   fly logs
   ```
   Должно быть:
   ```
   [RTMPServer] ✅ RTMP server started on port 1935
   ```

2. **Проверьте статус:**
   ```bash
   fly status
   ```

3. **Проверьте подключение:**
   ```bash
   telnet your-app-name.fly.dev 1935
   ```

---

## Сравнение платформ

| Параметр | Render | Railway | Fly.io |
|----------|--------|--------|--------|
| **Кастомные TCP порты** | ❌ Нет | ✅ Да (TCP-прокси) | ✅ Да (fly.toml) |
| **RTMP порт 1935** | ❌ Не поддерживается | ✅ Поддерживается | ✅ Поддерживается |
| **Сложность настройки** | ⭐⭐⭐ Сложно (нужен ngrok/VPS) | ⭐⭐ Средне | ⭐⭐ Средне |
| **Бесплатный план** | ✅ Да | ✅ Да (ограничен) | ✅ Да (ограничен) |
| **Стоимость** | $7/месяц | Pay-as-you-go | Pay-as-you-go |
| **Рекомендация** | ❌ Не подходит для RTMP | ✅ Подходит | ✅ Подходит |

---

## Миграция с Render на Railway/Fly.io

### Шаги миграции:

1. **Создайте проект на Railway или Fly.io**

2. **Скопируйте переменные окружения:**
   - Экспортируйте переменные из Render
   - Импортируйте в Railway/Fly.io

3. **Обновите RTMP_HOST:**
   - Railway: используйте `RAILWAY_PUBLIC_DOMAIN` или TCP-прокси URL
   - Fly.io: используйте `your-app-name.fly.dev`

4. **Обновите код (если нужно):**
   ```typescript
   // В livekit-room-composite-transcriber.ts
   const rtmpHost = 
     process.env.RAILWAY_PUBLIC_DOMAIN ||  // Railway
     process.env.FLY_APP_NAME ? `${process.env.FLY_APP_NAME}.fly.dev` : // Fly.io
     process.env.RTMP_HOST || 
     'localhost'
   ```

5. **Деплой и тестирование:**
   - Деплой на новую платформу
   - Проверьте работу RTMP сервера
   - Проверьте транскрипцию

6. **Обновите DNS/домены (если нужно):**
   - Если используете кастомный домен, обновите DNS записи

---

## Рекомендация

**Для вашего случая:**

✅ **Railway** - проще в настройке, хорошая документация
✅ **Fly.io** - больше контроля, гибкая конфигурация

**Обе платформы решают проблему Render с RTMP портом!**

---

## Troubleshooting

### Railway: TCP-прокси не работает

**Проблема:** RTMP поток не подключается через TCP-прокси.

**Решение:**
1. Проверьте, что TCP-прокси настроен в Networking
2. Используйте правильный порт (1935)
3. Проверьте firewall настройки Railway

### Fly.io: Порт 1935 не открыт

**Проблема:** Порт 1935 не доступен извне.

**Решение:**
1. Проверьте `fly.toml` - должен быть `[[services.ports]]` для порта 1935
2. Убедитесь, что `handlers = ["tcp"]` для RTMP порта
3. Перезапустите приложение: `fly restart`

### RTMP поток не подключается

**Проблема:** Egress не может подключиться к RTMP серверу.

**Решение:**
1. Проверьте `RTMP_HOST` и `RTMP_PORT` в переменных окружения
2. Убедитесь, что RTMP сервер запущен (проверьте логи)
3. Проверьте, что порт доступен: `telnet RTMP_HOST RTMP_PORT`


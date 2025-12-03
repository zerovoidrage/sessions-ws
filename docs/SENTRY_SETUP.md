# Настройка Sentry для мониторинга ошибок

## 1. Создание проекта в Sentry

1. Перейди на [https://sentry.io](https://sentry.io) и зарегистрируйся/войди
2. Создай новый проект:
   - Выбери платформу: **Next.js**
   - Название проекта: `rooms` (или любое другое)
   - Организация: выбери существующую или создай новую

## 2. Получение DSN

После создания проекта Sentry покажет **DSN** (Data Source Name). Он выглядит примерно так:

```
https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
```

Скопируй этот DSN — он понадобится для настройки переменных окружения.

## 3. Настройка переменных окружения

### Локальная разработка (`.env.local`)

Создай или обнови файл `.env.local` в корне проекта:

```env
# Sentry Configuration
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=rooms
```

**Важно:**
- `NEXT_PUBLIC_SENTRY_DSN` — используется для клиентской части (браузер)
- `SENTRY_DSN` — используется для серверной части (опционально, можно использовать тот же DSN)
- `SENTRY_ORG` — slug твоей организации в Sentry (можно найти в настройках организации)
- `SENTRY_PROJECT` — название проекта (обычно `rooms`)

### Production (Vercel)

В настройках проекта на Vercel:

1. Перейди в **Settings → Environment Variables**
2. Добавь те же переменные:
   - `NEXT_PUBLIC_SENTRY_DSN`
   - `SENTRY_DSN` (опционально)
   - `SENTRY_ORG`
   - `SENTRY_PROJECT`

**Примечание:** Для production убедись, что переменные доступны для всех окружений (Production, Preview, Development).

## 4. Проверка работы

### В Development

Sentry по умолчанию отключен в dev-режиме (см. `next.config.js`). Чтобы включить:

1. Временно отключи проверку в `next.config.js`:
```js
disableServerWebpackPlugin: false,  // было: process.env.NODE_ENV !== 'production'
disableClientWebpackPlugin: false,  // было: process.env.NODE_ENV !== 'production'
```

2. Или установи переменную окружения:
```env
NODE_ENV=production
```

### Тестирование

Чтобы протестировать отправку ошибки:

1. Открой приложение в браузере
2. В консоли браузера выполни:
```javascript
throw new Error('Test Sentry error')
```

3. Или создай тестовую ошибку в коде (временно):
```tsx
// В любом компоненте
useEffect(() => {
  throw new Error('Test Sentry error')
}, [])
```

4. Проверь в дашборде Sentry — ошибка должна появиться через несколько секунд

## 5. Настройки Source Maps (опционально)

Для лучшей отладки в production можно загружать source maps в Sentry:

1. Установи Sentry CLI (если еще не установлен):
```bash
npm install -g @sentry/cli
```

2. Авторизуйся:
```bash
sentry-cli login
```

3. Source maps будут автоматически загружаться при сборке, если настроены `SENTRY_ORG` и `SENTRY_PROJECT`

## 6. Использование в коде

### Автоматический мониторинг

Ошибки автоматически отправляются в Sentry через:
- **ErrorBoundary** — перехватывает ошибки React компонентов
- **Конфигурации Sentry** — автоматически перехватывают необработанные ошибки

### Ручная отправка ошибок

Используй утилиту `logError`:

```typescript
import { logError } from '@/lib/error-handling'

try {
  // какой-то код
} catch (error) {
  logError(error instanceof Error ? error : new Error(String(error)), {
    context: 'user-action',
    userId: user.id,
  })
}
```

### Отправка сообщений

```typescript
import { logMessage } from '@/lib/error-handling'

logMessage('Something important happened', 'info', {
  userId: user.id,
  action: 'session-created',
})
```

## 7. Фильтрация ошибок

В конфигурационных файлах (`sentry.client.config.ts`, `sentry.server.config.ts`) уже настроена фильтрация:
- Игнорируются ошибки из браузерных расширений
- Можно добавить дополнительную фильтрацию в `beforeSend`

## 8. Мониторинг в Sentry Dashboard

После настройки ты сможешь видеть:
- Все ошибки в реальном времени
- Стек-трейсы с source maps (если настроены)
- Контекст ошибок (браузер, ОС, пользователь и т.д.)
- Session Replay (запись действий пользователя при ошибке)

## Troubleshooting

### Sentry не отправляет ошибки

1. Проверь, что DSN правильный
2. Проверь, что переменные окружения установлены
3. Проверь консоль браузера/сервера на ошибки Sentry
4. В dev-режиме Sentry может быть отключен (см. раздел 4)

### Source maps не работают

1. Убедись, что `SENTRY_ORG` и `SENTRY_PROJECT` установлены
2. Проверь авторизацию Sentry CLI: `sentry-cli login`
3. Проверь логи сборки на наличие ошибок загрузки source maps

### Слишком много ошибок

1. Настрой фильтрацию в `beforeSend` в конфигурационных файлах
2. Используй `tracesSampleRate` для ограничения объема данных
3. Настрой alerts в Sentry для уведомлений только о критических ошибках


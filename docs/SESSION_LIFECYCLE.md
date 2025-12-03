# Жизненный цикл сессий

Документ описывает все способы завершения сессий, временные рамки и автоматические процессы.

---

## Статусы сессий

### `CREATED`
**Описание:** Сессия создана, но никто еще не заходил.

**Когда устанавливается:**
- При создании новой сессии через `POST /api/sessions`

**Переходы:**
- `CREATED → LIVE` — при первом подключении участника
- `CREATED → EXPIRED` — автоматически через 24 часа, если никто не зашел

---

### `LIVE`
**Описание:** Сессия активна, хотя бы один участник заходил.

**Когда устанавливается:**
- При первом подключении участника к LiveKit комнате
- Устанавливается `startedAt` (время начала сессии)

**Переходы:**
- `LIVE → ENDED` — ручное завершение или автоматическое (после 30 минут неактивности)

**Обновления:**
- `lastActivityAt` обновляется при каждом подключении участника
- `lastActivityAt` обновляется при получении транскриптов

---

### `ENDED`
**Описание:** Сессия завершена, готова к AI-анализу.

**Когда устанавливается:**
- Ручное завершение (кнопка "End session")
- Автоматическое завершение неактивных сессий

**Причины завершения (`endReason`):**
- `ADMIN_ENDED` — владелец space нажал "End session"
- `AUTO_EMPTY_ROOM` — автоматическое завершение после 30 минут неактивности

**Что происходит:**
- Устанавливается `endedAt`
- Рассчитывается `durationSeconds` (разница между `endedAt` и `startedAt`)
- Останавливается серверная транскрипция
- Сохраняется сырой транскрипт в Vercel Blob
- Создается `SessionAnalysis` со статусом `PENDING` (для AI-анализа)

---

### `EXPIRED`
**Описание:** Сессия протухла, никто не зашел.

**Когда устанавливается:**
- Автоматически через 24 часа после создания, если статус остался `CREATED`

**Причина завершения (`endReason`):**
- `EXPIRED_NO_JOIN` — никто не зашел в течение 24 часов

**Что происходит:**
- `endedAt` остается `null` (звонка не было)
- `durationSeconds` = `null`
- AI-анализ НЕ создается

---

## Способы завершения сессий

### 1. Ручное завершение (`ADMIN_ENDED`)

**Триггер:** Пользователь нажимает кнопку "End session"

**API:** `POST /api/sessions/[slug]/end`

**Права доступа:**
- Только `OWNER` space может завершить сессию
- Проверка через `getUserRoleInSpace(userId, spaceId)`

**Логика:**
1. Проверка прав доступа
2. Проверка статуса (идемпотентность: если уже `ENDED` или `EXPIRED`, возвращает успех)
3. Обновление сессии:
   - `status = ENDED`
   - `endReason = ADMIN_ENDED`
   - `endedByUserId = currentUser.id`
   - `endedAt = now()`
   - `durationSeconds = (endedAt - startedAt)` в секундах
4. Остановка серверной транскрипции
5. Сохранение сырого транскрипта в Vercel Blob
6. Создание `SessionAnalysis` со статусом `PENDING`

**Use case:** `endSession(sessionId, endedByUserId)`

---

### 2. Автоматическое завершение неактивных сессий (`AUTO_EMPTY_ROOM`)

**Триггер:** Cron job каждые 10 минут

**API:** `GET /api/cron/auto-end-sessions`

**Расписание:** `*/10 * * * *` (каждые 10 минут)

**Условия:**
- Статус сессии = `LIVE`
- `lastActivityAt` < `now() - 30 минут`
- `lastActivityAt` не `null`

**Логика:**
1. Поиск неактивных LIVE сессий через `findInactiveLiveSessions(30)`
2. Для каждой сессии:
   - Проверка статуса (идемпотентность: если уже не `LIVE`, пропускаем)
   - Обновление:
     - `status = ENDED`
     - `endReason = AUTO_EMPTY_ROOM`
     - `endedAt = now()` (если еще не установлено)
     - `durationSeconds = (endedAt - startedAt)` в секундах
   - Создание `SessionAnalysis` со статусом `PENDING`

**Use case:** `autoEndInactiveSessions()`

**Константа:** `INACTIVE_MINUTES = 30`

**Защита:**
- Проверка `CRON_SECRET` в заголовке `Authorization: Bearer ${CRON_SECRET}`
- Только Vercel Cron Jobs может вызывать endpoint

---

### 3. Истечение срока неактивированных сессий (`EXPIRED_NO_JOIN`)

**Триггер:** Cron job каждый час

**API:** `GET /api/cron/expire-sessions`

**Расписание:** `0 * * * *` (в начале каждого часа)

**Условия:**
- Статус сессии = `CREATED`
- `createdAt` < `now() - 24 часа`
- `startedAt` = `null` (никто не зашел)

**Логика:**
1. Поиск протухших CREATED сессий через `findOldCreatedSessions(24)`
2. Для каждой сессии:
   - Проверка статуса (идемпотентность: если уже не `CREATED`, пропускаем)
   - Обновление:
     - `status = EXPIRED`
     - `endReason = EXPIRED_NO_JOIN`
     - `endedAt = null` (звонка не было)
     - `durationSeconds = null`
3. AI-анализ НЕ создается

**Use case:** `expireOldCreatedSessions()`

**Константа:** `EXPIRE_HOURS = 24`

**Защита:**
- Проверка `CRON_SECRET` в заголовке `Authorization: Bearer ${CRON_SECRET}`
- Только Vercel Cron Jobs может вызывать endpoint

---

## Временные рамки

### Неактивность LIVE сессий
- **Порог:** 30 минут без активности
- **Проверка:** каждые 10 минут
- **Действие:** автоматическое завершение с `endReason = AUTO_EMPTY_ROOM`

**Что считается активностью:**
- Подключение участника (`upsertParticipantOnJoin`)
- Получение транскриптов (обновление `lastActivityAt`)

**Почему 30 минут:**
- Достаточно для паузы в разговоре
- Не слишком долго, чтобы не занимать ресурсы
- Баланс между удобством и эффективностью

---

### Истечение CREATED сессий
- **Порог:** 24 часа после создания
- **Проверка:** каждый час
- **Действие:** перевод в `EXPIRED` с `endReason = EXPIRED_NO_JOIN`

**Почему 24 часа:**
- Достаточно времени для планирования встречи
- Не слишком долго, чтобы не засорять базу данных
- Стандартный срок для "будущих" встреч

---

## Cron Jobs

### Настройка в Vercel

**Файл:** `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/auto-end-sessions",
      "schedule": "*/10 * * * *"
    },
    {
      "path": "/api/cron/expire-sessions",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Расписание:**
- `*/10 * * * *` — каждые 10 минут (автозавершение неактивных)
- `0 * * * *` — каждый час в начале часа (истечение срока)

### Формат расписания (Cron)

```
┌───────────── минута (0 - 59)
│ ┌───────────── час (0 - 23)
│ │ ┌───────────── день месяца (1 - 31)
│ │ │ ┌───────────── месяц (1 - 12)
│ │ │ │ ┌───────────── день недели (0 - 6) (воскресенье = 0)
│ │ │ │ │
* * * * *
```

**Примеры:**
- `*/10 * * * *` — каждые 10 минут
- `0 * * * *` — каждый час в начале часа
- `0 0 * * *` — каждый день в полночь
- `0 0 * * 0` — каждое воскресенье в полночь

### Безопасность

**Переменная окружения:** `CRON_SECRET`

**Проверка:**
```typescript
const authHeader = req.headers.get('authorization')
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return new NextResponse('Unauthorized', { status: 401 })
}
```

**Настройка в Vercel:**
1. Перейти в Settings → Environment Variables
2. Добавить `CRON_SECRET` с случайным значением (например, `openssl rand -hex 32`)
3. Использовать в Production, Preview, Development

**Генерация секрета:**
```bash
openssl rand -hex 32
```

**Важно:** 
- Vercel автоматически добавляет заголовок `Authorization: Bearer ${CRON_SECRET}` при вызове cron jobs
- Убедись, что `CRON_SECRET` установлен в environment variables перед деплоем

---

## Идемпотентность

Все операции завершения сессий **идемпотентны**:

- Повторный вызов не ломает данные
- Если сессия уже завершена, операция просто игнорируется
- Безопасно вызывать несколько раз

**Примеры:**
- `endSession()` для уже `ENDED` сессии → возвращает успех без изменений
- `autoEndInactiveSessions()` для уже `ENDED` сессии → пропускает
- `expireOldCreatedSessions()` для уже `EXPIRED` сессии → пропускает

---

## AI-анализ

### Когда создается

**Создается для:**
- Сессий со статусом `ENDED`
- Независимо от `endReason` (`ADMIN_ENDED` или `AUTO_EMPTY_ROOM`)

**НЕ создается для:**
- Сессий со статусом `EXPIRED` (`EXPIRED_NO_JOIN`)
- Сессий со статусом `CREATED` или `LIVE`

### Процесс

1. При завершении сессии вызывается `scheduleSessionForAnalysis(sessionId)`
2. Проверка статуса сессии (должен быть `ENDED`)
3. Создание или обновление `SessionAnalysis`:
   - Если не существует → создается со статусом `PENDING`
   - Если уже `PENDING` или `FAILED` → остается как есть
   - Если `DONE` или `RUNNING` → игнорируется

---

## Логирование

### Cron Jobs

**Успешное выполнение:**
```
[cron/auto-end-sessions] ✅ Completed { endedCount: 3, timestamp: "2025-12-03T..." }
[cron/expire-sessions] ✅ Completed { expiredCount: 1, timestamp: "2025-12-03T..." }
```

**Ошибки:**
```
[cron/auto-end-sessions] ❌ Error: ...
[autoEndInactiveSessions] Failed to end session abc123: ...
```

### Ручное завершение

**Успешное завершение:**
```
[endSession] ✅ Session ended by admin
```

**Ошибки:**
```
[endSession] Failed to stop server transcription: ...
[endSession] Failed to finalize transcript: ...
```

---

## Мониторинг

### Метрики для отслеживания

1. **Количество завершенных сессий:**
   - `ADMIN_ENDED` — ручное завершение
   - `AUTO_EMPTY_ROOM` — автоматическое завершение
   - `EXPIRED_NO_JOIN` — истечение срока

2. **Средняя длительность сессий:**
   - `durationSeconds` для `ENDED` сессий
   - Исключить `EXPIRED` (там `durationSeconds = null`)

3. **Частота автоматических завершений:**
   - Сколько сессий завершается автоматически vs вручную
   - Тренды по времени неактивности

### Запросы для анализа

```sql
-- Статистика по причинам завершения
SELECT 
  "endReason",
  COUNT(*) as count,
  AVG("durationSeconds") as avg_duration_seconds
FROM "VideoSession"
WHERE status = 'ENDED'
GROUP BY "endReason";

-- Сессии, завершенные автоматически за последние 24 часа
SELECT COUNT(*) 
FROM "VideoSession"
WHERE status = 'ENDED' 
  AND "endReason" = 'AUTO_EMPTY_ROOM'
  AND "endedAt" > NOW() - INTERVAL '24 hours';
```

---

## Настройка в Vercel

### Шаг 1: Добавить CRON_SECRET

1. Перейти в Vercel Dashboard → Project → Settings → Environment Variables
2. Добавить новую переменную:
   - **Name:** `CRON_SECRET`
   - **Value:** сгенерировать случайную строку (например, через `openssl rand -hex 32`)
   - **Environment:** Production, Preview, Development (все три)
3. Сохранить

**Генерация секрета:**
```bash
openssl rand -hex 32
```

### Шаг 2: Деплой

После добавления `CRON_SECRET` и деплоя проекта:
- Vercel автоматически обнаружит `vercel.json` с настройками cron jobs
- Cron jobs начнут работать автоматически
- Проверить можно в Vercel Dashboard → Project → Settings → Cron Jobs

### Шаг 3: Проверка работы

**Локальное тестирование (без расписания):**
```bash
# Установить CRON_SECRET в .env.local
CRON_SECRET=your-secret-here

# Вызвать endpoint вручную
curl -H "Authorization: Bearer your-secret-here" http://localhost:3000/api/cron/auto-end-sessions
```

**В Production:**
- Проверить логи в Vercel Dashboard
- Искать сообщения `[cron/auto-end-sessions] ✅ Completed`
- Проверить, что сессии завершаются автоматически

---

## Резюме

### Временные рамки

| Событие | Порог | Проверка | Действие |
|---------|-------|----------|----------|
| Неактивность LIVE | 30 минут | Каждые 10 минут | `ENDED` + `AUTO_EMPTY_ROOM` |
| Истечение CREATED | 24 часа | Каждый час | `EXPIRED` + `EXPIRED_NO_JOIN` |

### Причины завершения

| `endReason` | Триггер | AI-анализ | `durationSeconds` |
|-------------|---------|-----------|-------------------|
| `ADMIN_ENDED` | Ручное завершение | ✅ Создается | ✅ Рассчитывается |
| `AUTO_EMPTY_ROOM` | Автоматическое (30 мин) | ✅ Создается | ✅ Рассчитывается |
| `EXPIRED_NO_JOIN` | Истечение срока (24 ч) | ❌ Не создается | `null` |

### Права доступа

- **Ручное завершение:** только `OWNER` space
- **Автоматическое завершение:** только Vercel Cron Jobs (через `CRON_SECRET`)

---

**Дата создания:** 2025-12-03  
**Версия:** 1.0  
**Статус:** ✅ Актуально


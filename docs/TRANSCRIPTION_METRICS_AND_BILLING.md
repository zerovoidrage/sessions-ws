# Метрики, мониторинг и учёт стоимости транскрипции

## Обзор

Система учёта использования транскрипции включает:
- Клиентские метрики (время работы, количество сообщений, ошибки)
- Feature flags для управления доступом
- Ограничители по количеству активных транскрипций
- Учёт стоимости транскрипции (минуты, стоимость)
- API для получения статистики

## Компоненты

### 1. Клиентские метрики (`transcription-metrics.ts`)

Отслеживает на клиенте:
- Время начала/окончания транскрипции
- Количество отправленных аудио-чанков
- Количество полученных транскриптов (partial и final)
- Ошибки
- Общая длительность в секундах и минутах

**Использование:**
```typescript
import { clientTranscriptionMetrics } from '@/modules/core/sessions/infra/transcription/transcription-metrics'

// При старте
clientTranscriptionMetrics.startSession(sessionSlug, participantIdentity)

// При отправке аудио
clientTranscriptionMetrics.incrementAudioChunks(sessionSlug, participantIdentity)

// При получении транскрипта
clientTranscriptionMetrics.incrementTranscripts(sessionSlug, participantIdentity, isFinal)

// При ошибке
clientTranscriptionMetrics.recordError(sessionSlug, participantIdentity, errorMessage)

// При завершении
const metrics = clientTranscriptionMetrics.endSession(sessionSlug, participantIdentity)
```

### 2. Feature Flags (`transcription-flags.ts`)

Управление доступом к транскрипции:

**Переменные окружения:**
- `NEXT_PUBLIC_TRANSCRIPTION_ENABLED` - глобальное включение/выключение (по умолчанию `true`)

**Конфигурация:**
```typescript
{
  globalEnabled: true,                      // Глобальный флаг
  userEnabled: true,                        // Доступ для пользователя
  sessionEnabled: true,                     // Доступ для сессии
  maxActiveTranscriptionsPerUser: 5,        // Макс. транскрипций на пользователя
  maxActiveTranscriptionsPerSession: 10,    // Макс. транскрипций на сессию
  maxTranscriptionMinutes: 0,               // Макс. минут (0 = без ограничений)
}
```

**Использование:**
```typescript
import { 
  isTranscriptionEnabledForSession,
  canStartTranscriptionForUser,
} from '@/modules/core/sessions/infra/transcription/transcription-flags'

// Проверка доступа
if (!isTranscriptionEnabledForSession(sessionSlug)) {
  return // Транскрипция отключена
}

// Проверка ограничений
const check = await canStartTranscriptionForUser(userId, currentActiveCount)
if (!check.allowed) {
  console.error(check.reason)
  return
}
```

### 3. Ограничители (`transcription-limits.ts`)

Проверка ограничений по количеству активных транскрипций:

```typescript
import { checkTranscriptionLimits } from '@/modules/core/sessions/infra/transcription/transcription-limits'

const check = await checkTranscriptionLimits({
  sessionId: session.id,
  userId: user.id,
})

if (!check.allowed) {
  console.error('Limits exceeded:', check.reasons)
}
```

### 4. Учёт использования (`transcription-usage.repository.ts`)

Сохранение и получение данных об использовании:

**Модель БД:**
```prisma
model TranscriptionUsage {
  id              String
  videoSessionId  String
  participantId   String?
  userId          String?
  
  startedAt       DateTime
  endedAt         DateTime?
  
  durationSeconds Int
  durationMinutes Int
  
  audioChunksSent Int
  transcriptsReceived Int
  finalTranscripts Int
  partialTranscripts Int
  
  costPerMinute   Float     @default(0.01)
  totalCost       Float
  
  errorsCount     Int
  
  createdAt       DateTime
  updatedAt       DateTime
}
```

**Функции:**
- `createTranscriptionUsage()` - создание записи
- `updateTranscriptionUsage()` - обновление при завершении
- `getTranscriptionUsageBySession()` - статистика по сессии
- `getTranscriptionUsageByUser()` - статистика по пользователю
- `getTranscriptionStatsByUser()` - агрегированная статистика (минуты, стоимость)

### 5. API Endpoints

#### `POST /api/transcription/usage/save`
Сохраняет информацию об использовании транскрипции в БД.

**Body:**
```json
{
  "sessionSlug": "session-slug",
  "participantIdentity": "user-id:session-id",
  "userId": "user-id",
  "startedAt": "2024-01-01T00:00:00Z",
  "endedAt": "2024-01-01T00:05:00Z",
  "durationSeconds": 300,
  "durationMinutes": 5,
  "audioChunksSent": 1500,
  "transcriptsReceived": 50,
  "finalTranscripts": 10,
  "partialTranscripts": 40,
  "errorsCount": 0
}
```

#### `GET /api/sessions/[slug]/transcription/usage`
Получает статистику использования транскрипции для сессии.

**Response:**
```json
{
  "usage": [...],
  "stats": {
    "totalMinutes": 15,
    "totalCost": 0.15,
    "totalSessions": 3,
    "averageDurationMinutes": 5
  }
}
```

#### `GET /api/transcription/stats`
Получает статистику использования транскрипции для текущего пользователя.

**Response:**
```json
{
  "totalMinutes": 60,
  "totalCost": 0.60,
  "totalSessions": 12,
  "averageDurationMinutes": 5
}
```

## Интеграция в код

### В `useLocalParticipantTranscription`

Метрики интегрированы автоматически:
- При старте транскрипции - инициализация метрик
- При отправке аудио - обновление счётчика чанков
- При получении транскриптов - обновление счётчиков
- При ошибках - запись ошибок
- При остановке - сохранение использования в БД

### В `SessionContent`

Передаётся `userId` для учёта:
```typescript
const { start, stop, isActive } = useLocalParticipantTranscription({
  // ...
  userId: currentUserId,
})
```

## Миграция БД

Для применения изменений в БД выполните:

```bash
# Для dev окружения (синхронизация схемы)
npm run db:push

# Для production (создание миграции)
npm run db:migrate
```

Или вручную создайте миграцию:
```bash
npx prisma migrate dev --name add_transcription_usage
```

## Мониторинг и алерты

### Метрики для мониторинга:

1. **Количество активных транскрипций:**
   - По пользователям (через `getTranscriptionUsageByUser`)
   - По сессиям (через `getTranscriptionUsageBySession`)

2. **Стоимость:**
   - Общая стоимость за период (через `getTranscriptionStatsByUser`)
   - Стоимость по сессиям

3. **Ошибки:**
   - Количество ошибок на сессию
   - Логи ошибок в консоли браузера

### Рекомендуемые алерты:

1. **Превышение лимита активных транскрипций** (на пользователя/сессию)
2. **Высокая стоимость транскрипции** (например, >$X за день)
3. **Много ошибок** (например, >10% сессий имеют ошибки)

## Настройка стоимости

По умолчанию: `$0.01 за минуту` (можно изменить через env переменную `TRANSCRIPTION_COST_PER_MINUTE`)

Для изменения стоимости в коде:
```typescript
const costPerMinute = parseFloat(process.env.TRANSCRIPTION_COST_PER_MINUTE || '0.01')
```

## Будущие улучшения

1. **Динамические feature flags** (хранение в БД вместо env)
2. **Rate limiting** (ограничение количества запросов на API)
3. **Webhooks** (уведомления при превышении лимитов)
4. **Dashboard** (визуализация статистики использования)
5. **Экспорт данных** (CSV/Excel для анализа)


# Архитектура модуля Sessions

Полное описание архитектуры модуля сессий: структура, база данных, API, use cases и инфраструктура.

---

## Обзор

Модуль `sessions` — это core-домен, отвечающий за управление видеосессиями (видеозвонками), участниками, транскрипцией и анализом сессий.

**Расположение:** `src/modules/core/sessions/`

**Архитектурный паттерн:** Clean Architecture с разделением на слои:
- **Domain** — типы и доменные правила (без зависимостей от БД/HTTP)
- **Application** — use cases (бизнес-логика)
- **Infrastructure** — адаптеры (Prisma, LiveKit, внешние сервисы)
- **API** — HTTP endpoints (тонкий слой)

---

## Структура модуля

```
src/modules/core/sessions/
├── domain/                    # Доменные типы и правила
│   └── session.types.ts       # Типы Session, SessionStatus, AnalysisStatus
│
├── application/               # Use cases (бизнес-логика)
│   ├── createSession.ts
│   ├── deleteSession.ts
│   ├── endSession.ts
│   ├── getSessionBySlug.ts
│   ├── listSessionsBySpace.ts
│   ├── upsertParticipantOnJoin.ts
│   ├── startServerTranscription.ts
│   ├── stopServerTranscription.ts
│   ├── finalizeSessionTranscript.ts
│   ├── scheduleSessionForAnalysis.ts
│   ├── ensureSessionAnalysisCreated.ts
│   ├── autoEndInactiveSessions.ts
│   ├── expireOldCreatedSessions.ts
│   ├── selectNewTranscriptionHost.ts
│   └── saveTranscriptionUsage.ts
│
├── api/                       # HTTP endpoints
│   ├── createSessionEndpoint.ts
│   ├── deleteSessionEndpoint.ts
│   ├── endSessionEndpoint.ts
│   ├── listSessionsEndpoint.ts
│   ├── upsertParticipantOnJoinEndpoint.ts
│   ├── startTranscriptionServiceEndpoint.ts
│   └── selectNewTranscriptionHostEndpoint.ts
│
└── infra/                     # Инфраструктура (адаптеры)
    ├── prisma/                # Репозитории Prisma
    │   ├── sessions.repository.ts
    │   ├── transcripts.repository.ts
    │   └── session-analysis.repository.ts
    ├── participants/          # Репозиторий участников
    │   └── participants.repository.ts
    ├── livekit/               # LiveKit интеграция
    │   ├── token.service.ts
    │   └── client-config.ts
    └── transcription/         # Транскрипция
        ├── appendTranscriptChunk.ts
        ├── listSessionTranscripts.ts
        ├── transcript.types.ts
        ├── transcription-flags.ts
        ├── transcription-limits.ts
        ├── transcription-metrics.ts
        ├── transcription-usage.repository.ts
        └── transcription-usage.types.ts
```

---

## База данных (Prisma Schema)

### Модель `VideoSession`

Основная сущность — видеосессия (видеозвонок).

```prisma
model VideoSession {
  id              String        @id @default(cuid())
  slug            String        @unique              // Уникальный URL-friendly идентификатор
  title           String?                           // Название сессии
  createdByUserId String?                           // ID создателя
  status          SessionStatus @default(CREATED)   // Статус сессии
  createdAt       DateTime      @default(now())
  startedAt       DateTime?                         // Когда сессия стала LIVE
  endedAt         DateTime?                         // Когда сессия завершилась
  lastActivityAt  DateTime?                         // Последняя активность (для авто-завершения)
  
  spaceId String                                  // Привязка к рабочему пространству
  space   Space   @relation(fields: [spaceId], references: [id])
  
  // Raw transcript storage в Vercel Blob
  rawTranscriptBlobUrl   String?   // URL на JSON в Vercel Blob
  rawTranscriptSizeBytes Int?      // Размер файла в байтах
  rawTranscriptReadyAt   DateTime? // Когда сырой транскрипт был сохранен
  
  // Relations
  participants       Participant[]
  transcripts        TranscriptSegment[]
  transcriptionUsage TranscriptionUsage[]
  analysis           SessionAnalysis?
  
  @@index([spaceId])
  @@index([createdByUserId])
  @@index([status])
  @@index([lastActivityAt])
}
```

**Статусы сессии (`SessionStatus`):**
- `CREATED` — сессия создана, но никто еще не заходил
- `LIVE` — хотя бы один участник заходил (мит реально стартовал)
- `ENDED` — мит закончился, готов к AI-анализу
- `EXPIRED` — мит так и не начался и протух

### Модель `Participant`

Участник видеосессии.

```prisma
model Participant {
  id             String       @id @default(cuid())
  videoSessionId String
  videoSession   VideoSession @relation(fields: [videoSessionId], references: [id])
  
  userId String?                              // Привязка к User (если авторизован)
  user   User?   @relation(fields: [userId], references: [id])
  
  identity String // LiveKit identity (уникальный в рамках сессии)
  name     String?                            // Имя участника
  role     ParticipantRole @default(GUEST)    // HOST или GUEST
  joinedAt DateTime        @default(now())
  leftAt   DateTime?                          // Когда участник покинул сессию
  
  transcripts        TranscriptSegment[]
  transcriptionUsage TranscriptionUsage[]
  
  @@unique([videoSessionId, identity])
  @@index([videoSessionId])
}
```

**Роли участника (`ParticipantRole`):**
- `HOST` — хост сессии
- `GUEST` — гость

### Модель `TranscriptSegment`

Сегмент транскрипта (одно utterance от Gladia).

```prisma
model TranscriptSegment {
  id             String       @id @default(cuid())
  videoSessionId String
  videoSession   VideoSession @relation(fields: [videoSessionId], references: [id])
  
  participantId String?
  participant   Participant? @relation(fields: [participantId], references: [id])
  
  utteranceId String    // Gladia data.id (уникальный в рамках сессии)
  text        String
  language    String?
  isFinal     Boolean   @default(false)
  startedAt   DateTime  // Timestamp начала utterance
  endedAt     DateTime?
  createdAt   DateTime  @default(now())
  
  @@unique([videoSessionId, utteranceId])
  @@index([videoSessionId])
}
```

**Важно:**
- `utteranceId` — уникальный идентификатор от Gladia, используется для дедупликации
- `isFinal` — финальный транскрипт (true) или interim/draft (false)
- `startedAt` / `endedAt` — тайминги от Gladia (если доступны)

### Модель `TranscriptionUsage`

Учет использования транскрипции (для биллинга и метрик).

```prisma
model TranscriptionUsage {
  id String @id @default(cuid())
  
  videoSessionId String
  videoSession   VideoSession @relation(fields: [videoSessionId], references: [id])
  
  participantId String?
  participant   Participant? @relation(fields: [participantId], references: [id])
  
  userId String?
  user   User?   @relation(fields: [userId], references: [id])
  
  startedAt DateTime  @default(now())
  endedAt   DateTime?
  
  durationSeconds Int // Длительность в секундах
  durationMinutes Int // Длительность в минутах (округлённая вверх)
  
  audioChunksSent     Int @default(0)
  transcriptsReceived Int @default(0)
  finalTranscripts    Int @default(0)
  partialTranscripts  Int @default(0)
  
  costPerMinute Float @default(0.01) // Стоимость за минуту (по умолчанию $0.01)
  totalCost     Float @default(0)   // Общая стоимость
  
  errorsCount Int @default(0)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([videoSessionId])
  @@index([participantId])
  @@index([userId])
  @@index([createdAt])
}
```

### Модель `SessionAnalysis`

AI-анализ завершенной сессии.

```prisma
model SessionAnalysis {
  id         String          @id @default(cuid())
  sessionId  String          @unique
  session    VideoSession    @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  status     AnalysisStatus  @default(PENDING)
  createdAt  DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  
  summary    String?         // Краткое резюме сессии
  tasksJson  Json?           // Задачи в формате JSON
  risksJson  Json?           // Риски в формате JSON
  
  @@index([sessionId])
  @@index([status])
}
```

**Статусы анализа (`AnalysisStatus`):**
- `PENDING` — сессия завершена, анализ еще не стартовал или в очереди
- `RUNNING` — анализ в процессе
- `DONE` — анализ успешно завершен, summary/tasks заполнены
- `FAILED` — анализ упал (можно перезапустить)

---

## Domain Layer

### Типы (`domain/session.types.ts`)

```typescript
export type SessionStatus = 'CREATED' | 'LIVE' | 'ENDED' | 'EXPIRED'
export type ParticipantRole = 'HOST' | 'GUEST'
export type AnalysisStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'

export interface Session {
  id: string
  slug: string
  title?: string | null
  createdByUserId?: string | null
  spaceId: string
  status: SessionStatus
  createdAt: Date
  startedAt?: Date | null
  endedAt?: Date | null
  lastActivityAt?: Date | null
  rawTranscriptBlobUrl?: string | null
  rawTranscriptSizeBytes?: number | null
  rawTranscriptReadyAt?: Date | null
}

export interface CreateSessionInput {
  title?: string
  spaceId: string
  createdByUserId?: string
}

export interface SessionAnalysis {
  id: string
  sessionId: string
  status: AnalysisStatus
  createdAt: Date
  updatedAt: Date
  summary?: string | null
  tasksJson?: unknown | null
  risksJson?: unknown | null
}
```

**Принципы:**
- Типы не зависят от Prisma или HTTP
- Чистые TypeScript интерфейсы
- Доменные правила (например, статусы сессии)

---

## Application Layer (Use Cases)

### 1. `createSession`

**Файл:** `application/createSession.ts`

**Описание:** Создание новой сессии.

**Логика:**
1. Генерирует уникальный `slug` (8 символов nanoid)
2. Создает сессию со статусом `CREATED`
3. Все временные метки (`startedAt`, `endedAt`, `lastActivityAt`) = `null`

**Вход:**
```typescript
interface CreateSessionInput {
  title?: string
  spaceId: string
  createdByUserId?: string
}
```

**Выход:** `Session`

---

### 2. `upsertParticipantOnJoin`

**Файл:** `application/upsertParticipantOnJoin.ts`

**Описание:** Создание или обновление участника при подключении к комнате.

**Логика:**
1. Проверяет статус сессии
2. Если `CREATED` → переводит в `LIVE`, устанавливает `startedAt`
3. Обновляет `lastActivityAt` при любом join
4. Запускает серверную транскрипцию (HTTP API к WS/RTMP серверу)
5. Создает/обновляет участника в БД

**Вход:**
```typescript
interface UpsertParticipantOnJoinInput {
  sessionId: string
  identity: string
  name?: string
  role?: 'HOST' | 'GUEST'
  userId?: string | null
}
```

**Выход:** `Participant`

**Важно:**
- Используется при подключении к LiveKit комнате
- Участник создается в БД до первого транскрипта
- Транскрипция запускается автоматически при первом join

---

### 3. `endSession`

**Файл:** `application/endSession.ts`

**Описание:** Завершение сессии.

**Логика:**
1. Проверяет права доступа (только создатель или участник)
2. Обновляет статус на `ENDED`
3. Устанавливает `endedAt`
4. Останавливает серверную транскрипцию
5. Планирует AI-анализ (если нужно)

**Вход:** `sessionSlug: string`, `user: DomainUser`

**Выход:** `void`

---

### 4. `deleteSession`

**Файл:** `application/deleteSession.ts`

**Описание:** Удаление сессии и всех связанных данных.

**Логика:**
1. Проверяет права доступа
2. Удаляет все транскрипты
3. Удаляет всех участников
4. Удаляет сессию

**Вход:** `sessionSlug: string`, `user: DomainUser`

**Выход:** `void`

---

### 5. `listSessionsBySpace`

**Файл:** `application/listSessionsBySpace.ts`

**Описание:** Получение списка сессий для рабочего пространства.

**Логика:**
1. Проверяет доступ к пространству
2. Фильтрует по `spaceId`
3. Исключает `EXPIRED` сессии
4. Сортирует по `createdAt DESC`

**Вход:**
```typescript
interface ListSessionsBySpaceInput {
  spaceId: string
  userId: string
}
```

**Выход:** `Session[]`

---

### 6. `startServerTranscription`

**Файл:** `application/startServerTranscription.ts`

**Описание:** Запуск серверной транскрипции для сессии.

**Логика:**
1. Проверяет, что сессия в статусе `LIVE`
2. Вызывает HTTP API к WS/RTMP серверу
3. Логирует результат

**Вход:** `sessionId: string`, `sessionSlug: string`

**Выход:** `void`

**Важно:**
- WS/RTMP сервер работает отдельно от Next.js
- Использует `WS_SERVER_URL` из env
- Идемпотентный (можно вызывать несколько раз)

---

### 7. `finalizeSessionTranscript`

**Файл:** `application/finalizeSessionTranscript.ts`

**Описание:** Финализация транскрипта сессии (сохранение в Vercel Blob).

**Логика:**
1. Собирает все транскрипты сессии
2. Формирует JSON структуру
3. Сохраняет в Vercel Blob
4. Обновляет `rawTranscriptBlobUrl`, `rawTranscriptSizeBytes`, `rawTranscriptReadyAt`

**Вход:** `sessionId: string`

**Выход:** `void`

---

### 8. `scheduleSessionForAnalysis`

**Файл:** `application/scheduleSessionForAnalysis.ts`

**Описание:** Планирование AI-анализа завершенной сессии.

**Логика:**
1. Проверяет, что сессия в статусе `ENDED`
2. Создает `SessionAnalysis` со статусом `PENDING`
3. (В будущем) добавляет в очередь для обработки

**Вход:** `sessionId: string`

**Выход:** `void`

---

### 9. `autoEndInactiveSessions`

**Файл:** `application/autoEndInactiveSessions.ts`

**Описание:** Автоматическое завершение неактивных сессий.

**Логика:**
1. Находит сессии со статусом `LIVE` и `lastActivityAt` старше N минут
2. Переводит их в статус `ENDED`
3. Устанавливает `endedAt`

**Вход:** `inactiveMinutes: number`

**Выход:** `void`

**Использование:** Cron job или периодическая задача

---

### 10. `expireOldCreatedSessions`

**Файл:** `application/expireOldCreatedSessions.ts`

**Описание:** Истечение срока действия неактивированных сессий.

**Логика:**
1. Находит сессии со статусом `CREATED` старше N часов
2. Переводит их в статус `EXPIRED`

**Вход:** `expireHours: number`

**Выход:** `void`

**Использование:** Cron job или периодическая задача

---

## Infrastructure Layer

### Prisma Repositories

#### `sessions.repository.ts`

**Функции:**
- `createSession(input)` — создание сессии
- `getSessionBySlug(slug)` — получение по slug
- `getSessionById(id)` — получение по ID
- `listSessionsBySpace(spaceId)` — список для пространства
- `endSession(sessionId)` — завершение сессии
- `updateSessionStatus(sessionId, status, additionalData)` — обновление статуса
- `updateSessionActivity(sessionId, lastActivityAt)` — обновление активности
- `findInactiveLiveSessions(inactiveMinutes)` — поиск неактивных
- `findOldCreatedSessions(expireHours)` — поиск протухших
- `deleteSessionById(sessionId)` — удаление сессии
- `deleteAllSessions()` — удаление всех сессий (dev only)

**Принципы:**
- Только работа с БД, без бизнес-логики
- Маппинг Prisma моделей в доменные типы
- Транзакции для атомарных операций

---

#### `transcripts.repository.ts`

**Функции:**
- `appendTranscriptChunk(input)` — добавление сегмента транскрипта
- `listTranscriptsBySession(sessionSlug)` — список транскриптов сессии
- `getTranscriptSegmentByUtteranceId(sessionId, utteranceId)` — получение по utteranceId

**Важно:**
- Дедупликация по `utteranceId` (уникальный в рамках сессии)
- Поддержка interim и final транскриптов

---

#### `session-analysis.repository.ts`

**Функции:**
- `createSessionAnalysis(sessionId)` — создание анализа
- `getSessionAnalysisBySessionId(sessionId)` — получение анализа
- `updateSessionAnalysisStatus(sessionId, status)` — обновление статуса
- `updateSessionAnalysisResults(sessionId, summary, tasksJson, risksJson)` — обновление результатов

---

### Participants Repository

**Файл:** `infra/participants/participants.repository.ts`

**Функции:**
- `upsertParticipantByIdentity(input)` — создание/обновление участника
- `markParticipantLeft(sessionId, identity)` — отметка о выходе
- `getParticipantWithUserByIdentity(sessionId, identity)` — получение с данными пользователя
- `getActiveParticipantsBySessionId(sessionId)` — список активных участников

**Важно:**
- Уникальность по `(videoSessionId, identity)`
- Поддержка авторизованных и гостевых участников

---

### LiveKit Integration

**Файл:** `infra/livekit/token.service.ts`

**Функции:**
- `generateLiveKitToken(sessionSlug, identity, name, role)` — генерация токена для подключения

**Файл:** `infra/livekit/client-config.ts`

**Функции:**
- `getLiveKitConfig()` — конфигурация LiveKit клиента

---

### Transcription Infrastructure

#### `appendTranscriptChunk.ts`

**Описание:** Добавление сегмента транскрипта в БД.

**Логика:**
1. Получает сессию по `sessionSlug`
2. Находит участника по `participantIdentity` (если есть)
3. Дедуплицирует по `utteranceId`
4. Создает или обновляет `TranscriptSegment`

**Вход:**
```typescript
interface AppendTranscriptChunkInput {
  sessionSlug: string
  participantIdentity?: string
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
}
```

---

#### `transcription-usage.repository.ts`

**Функции:**
- `createTranscriptionUsage(input)` — создание записи использования
- `updateTranscriptionUsage(id, data)` — обновление метрик
- `getTranscriptionUsageBySessionId(sessionId)` — получение по сессии

**Метрики:**
- `audioChunksSent` — количество отправленных аудио чанков
- `transcriptsReceived` — количество полученных транскриптов
- `finalTranscripts` — количество финальных транскриптов
- `partialTranscripts` — количество interim транскриптов
- `durationSeconds` / `durationMinutes` — длительность
- `totalCost` — общая стоимость

---

## API Layer

### HTTP Endpoints

#### `POST /api/sessions`

**Файл:** `src/app/api/sessions/route.ts`

**Описание:** Создание новой сессии.

**Логика:**
1. Проверка авторизации
2. Rate limiting
3. Получение активного пространства
4. Вызов `createSessionEndpoint`
5. Возврат `{ slug: string }`

**Вход:**
```json
{
  "title": "Название сессии",
  "spaceId": "space-id" // опционально, используется activeSpaceId если не указан
}
```

**Выход:**
```json
{
  "slug": "abc12345"
}
```

---

#### `GET /api/sessions`

**Файл:** `src/app/api/sessions/route.ts`

**Описание:** Список сессий для активного пространства.

**Логика:**
1. Проверка авторизации
2. Получение активного пространства
3. Вызов `listSessionsEndpoint`
4. Возврат списка сессий

**Выход:**
```json
{
  "sessions": [
    {
      "id": "...",
      "slug": "abc12345",
      "title": "Название",
      "status": "LIVE",
      "createdAt": "2025-12-03T...",
      ...
    }
  ]
}
```

---

#### `DELETE /api/sessions/[slug]`

**Файл:** `src/app/api/sessions/[slug]/route.ts`

**Описание:** Удаление сессии.

**Логика:**
1. Проверка авторизации
2. Вызов `deleteSessionEndpoint`
3. Возврат `{ success: true }`

---

#### `POST /api/sessions/[slug]/end`

**Файл:** `src/app/api/sessions/[slug]/end/route.ts`

**Описание:** Завершение сессии.

**Логика:**
1. Проверка авторизации
2. Вызов `endSessionEndpoint`
3. Возврат `{ status: 'ok' }`

---

#### `GET /api/sessions/[slug]/token`

**Файл:** `src/app/api/sessions/[slug]/token/route.ts`

**Описание:** Получение LiveKit токена для подключения.

**Логика:**
1. Проверка авторизации
2. Получение сессии по slug
3. Генерация LiveKit токена
4. Возврат токена и конфигурации

**Выход:**
```json
{
  "token": "eyJ...",
  "url": "wss://...",
  "room": "session-slug"
}
```

---

#### `POST /api/sessions/[slug]/participants/join`

**Файл:** `src/app/api/sessions/[slug]/participants/join/route.ts`

**Описание:** Регистрация участника при подключении к комнате.

**Логика:**
1. Проверка авторизации (опционально, для гостей)
2. Вызов `upsertParticipantOnJoinEndpoint`
3. Возврат данных участника

**Вход:**
```json
{
  "identity": "user-id",
  "name": "Имя участника",
  "role": "HOST" // или "GUEST"
}
```

---

#### `GET /api/sessions/[slug]/participants`

**Файл:** `src/app/api/sessions/[slug]/participants/route.ts`

**Описание:** Список активных участников сессии.

**Логика:**
1. Проверка авторизации
2. Получение сессии
3. Получение активных участников
4. Возврат списка

---

#### `POST /api/sessions/[slug]/transcription/start`

**Файл:** `src/app/api/sessions/[slug]/transcription/start/route.ts`

**Описание:** Запуск серверной транскрипции.

**Логика:**
1. Проверка авторизации
2. Вызов `startTranscriptionServiceEndpoint`
3. Возврат результата

**Примечание:** Обычно вызывается автоматически при первом join через `upsertParticipantOnJoin`.

---

## Жизненный цикл сессии

### 1. Создание (`CREATED`)

```
User → POST /api/sessions
  → createSessionEndpoint
    → createSession
      → sessions.repository.createSession
        → Prisma: VideoSession.create(status: CREATED)
```

**Результат:**
- Сессия создана со статусом `CREATED`
- `slug` сгенерирован (8 символов)
- Все временные метки = `null`

---

### 2. Активация (`LIVE`)

```
User → GET /api/sessions/[slug]/token
  → LiveKit: подключение к комнате
    → POST /api/sessions/[slug]/participants/join
      → upsertParticipantOnJoinEndpoint
        → upsertParticipantOnJoin
          → updateSessionStatus(CREATED → LIVE)
          → updateSessionActivity
          → startServerTranscription (HTTP API к WS/RTMP серверу)
          → upsertParticipantByIdentity
```

**Результат:**
- Статус изменен на `LIVE`
- `startedAt` установлен
- `lastActivityAt` обновлен
- Участник создан в БД
- Транскрипция запущена

---

### 3. Активная сессия (`LIVE`)

**Процессы:**
- Участники подключаются/отключаются → `upsertParticipantOnJoin` / `markParticipantLeft`
- Транскрипты приходят → `appendTranscriptChunk`
- Активность обновляется → `updateSessionActivity`
- Метрики транскрипции → `saveTranscriptionUsage`

---

### 4. Завершение (`ENDED`)

```
User → POST /api/sessions/[slug]/end
  → endSessionEndpoint
    → endSession
      → updateSessionStatus(LIVE → ENDED)
      → updateSessionActivity
      → stopServerTranscription
      → scheduleSessionForAnalysis
```

**Результат:**
- Статус изменен на `ENDED`
- `endedAt` установлен
- Транскрипция остановлена
- Планируется AI-анализ

---

### 5. Автоматическое завершение

**Неактивные сессии:**
```
Cron → autoEndInactiveSessions(inactiveMinutes: 30)
  → findInactiveLiveSessions(30)
  → endSession (для каждой)
```

**Протухшие сессии:**
```
Cron → expireOldCreatedSessions(expireHours: 24)
  → findOldCreatedSessions(24)
  → updateSessionStatus(CREATED → EXPIRED)
```

---

## Интеграции

### LiveKit

**Назначение:** Видеосвязь и аудиострим.

**Использование:**
- Генерация токенов для подключения
- Отслеживание активных участников
- Получение аудио для транскрипции

**Файлы:**
- `infra/livekit/token.service.ts`
- `infra/livekit/client-config.ts`

---

### WS/RTMP Server

**Назначение:** Серверная транскрипция (RTMP → FFmpeg → Gladia → WebSocket).

**Интеграция:**
- HTTP API: `POST /api/transcription/start` (на WS/RTMP сервере)
- WebSocket: `wss://.../api/realtime/transcribe` (для клиентов)

**Переменные окружения:**
- `WS_SERVER_URL` — URL WS/RTMP сервера
- `NEXT_PUBLIC_WS_SERVER_URL` — публичный URL (для клиентов)

---

### Gladia Live v2

**Назначение:** Real-time STT (Speech-to-Text).

**Использование:**
- Интегрировано в WS/RTMP сервер
- Транскрипты приходят через WebSocket
- Сохраняются в БД через `appendTranscriptChunk`

---

### Vercel Blob

**Назначение:** Хранение сырых транскриптов.

**Использование:**
- `finalizeSessionTranscript` сохраняет JSON в Blob
- URL сохраняется в `rawTranscriptBlobUrl`

---

## Безопасность

### Авторизация

- Все API endpoints проверяют авторизацию через `getCurrentUser()`
- Участники могут быть авторизованными (`userId`) или гостями (`identity`)

### Права доступа

- **Создание сессии:** любой авторизованный пользователь
- **Удаление сессии:** только создатель
- **Завершение сессии:** создатель или участник
- **Просмотр сессий:** участники пространства

### Rate Limiting

- `POST /api/sessions` — строгий лимит (создание)
- `GET /api/sessions` — стандартный лимит

---

## Метрики и мониторинг

### Метрики транскрипции

**Модель:** `TranscriptionUsage`

**Отслеживается:**
- Длительность транскрипции
- Количество аудио чанков
- Количество транскриптов (final/partial)
- Стоимость
- Ошибки

### Логирование

**Ключевые события:**
- Создание сессии
- Активация сессии (CREATED → LIVE)
- Подключение участников
- Запуск/остановка транскрипции
- Завершение сессии
- Ошибки транскрипции

---

## Тестирование

### Unit тесты

**Файл:** `application/__tests__/createSession.test.ts`

**Покрытие:**
- Use cases (бизнес-логика)
- Репозитории (интеграционные тесты)

### Интеграционные тесты

**Покрытие:**
- API endpoints
- Интеграция с LiveKit
- Интеграция с WS/RTMP сервером

---

## Будущие улучшения

1. **Task Manager интеграция** — связь сессий с задачами
2. **Расширенный AI-анализ** — более детальный анализ транскриптов
3. **Уведомления** — уведомления о событиях сессии
4. **Аналитика** — детальная аналитика использования
5. **Масштабирование** — оптимизация для больших нагрузок

---

**Дата создания:** 2025-12-03  
**Версия:** 1.0  
**Статус:** ✅ Актуально



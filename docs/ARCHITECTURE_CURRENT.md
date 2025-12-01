# Rooms / Sessions — Текущая архитектура

## Обзор

Rooms / Sessions — веб-приложение для видеосессий с real-time транскрипцией. Проект построен на Next.js 14 (App Router) с модульной архитектурой, разделенной на core-домены.

---

## Технологический стек

### Frontend
- **Next.js 14** (App Router)
- **React 18** + **TypeScript**
- **Tailwind CSS** (кастомные токены)
- **Phosphor Icons**
- **LiveKit Client SDK** (видеосвязь)

### Backend
- **Next.js API Routes** (`app/api/**/route.ts`)
- **Prisma ORM** + **PostgreSQL** (Neon)
- **NextAuth.js** (Google OAuth)
- **Node.js WebSocket Server** (TypeScript, `ws`)

### Интеграции
- **LiveKit** (видеосвязь, WebRTC)
- **Gladia** (real-time транскрипция)
- **Cloudinary** (загрузка аватаров)
- **Sentry** (мониторинг ошибок и производительности)

---

## Архитектура модулей

### Структура `src/modules/core/`

Проект использует модульную архитектуру с разделением на core-домены:

```
src/modules/core/
├── identity/          # Авторизация и профиль пользователя
├── spaces/            # Рабочие пространства
├── sessions/          # Видеосессии
└── tasks/             # Task-менеджер (скелет, в разработке)
```

Каждый core-модуль имеет единообразную структуру:

```
<module>/
├── domain/            # Доменные типы и сущности (без Prisma/HTTP)
├── infra/             # Инфраструктура: Prisma, внешние сервисы
├── application/       # Бизнес-логика, use-cases
└── api/               # API endpoints (вызываются из app/api)
```

---

## Core-модули

### 1. Identity (`src/modules/core/identity/`)

**Назначение**: Авторизация, профиль пользователя, управление активным пространством.

#### Структура

```
identity/
├── domain/
│   └── user.types.ts          # DomainUser, UpdateProfileInput
├── infra/
│   ├── user.repository.ts     # CRUD пользователей, генерация noAvatarColor
│   ├── auth.config.ts         # NextAuth конфигурация (Google OAuth)
│   └── cloudinary.ts          # Подпись для загрузки аватаров
├── application/
│   ├── getCurrentUser.ts      # Получение текущего пользователя из сессии
│   ├── updateProfile.ts       # Обновление профиля
│   ├── setActiveSpace.ts      # Установка активного пространства
│   └── ensureUserHasActiveSpace.ts  # Гарантия наличия активного пространства
└── api/
    ├── getProfileEndpoint.ts
    ├── updateProfileEndpoint.ts
    └── getAvatarUploadSignatureEndpoint.ts
```

#### HTTP Routes
- `GET /api/identity/profile` — получить профиль
- `PATCH /api/identity/profile` — обновить профиль
- `GET /api/identity/avatar/sign` — получить подпись для загрузки аватара
- `GET/POST /api/auth/[...nextauth]` — NextAuth endpoints

#### Особенности
- **Google OAuth** через NextAuth
- **Автоматическая генерация `noAvatarColor`** (пастельные цвета, детерминированный hash по email)
- **PrismaAdapter** для NextAuth
- **Расширенные типы сессии** (`displayName`, `avatarUrl`, `noAvatarColor`, `activeSpaceId`)

---

### 2. Spaces (`src/modules/core/spaces/`)

**Назначение**: Управление рабочими пространствами с поддержкой режимов.

#### Структура

```
spaces/
├── domain/
│   └── space.types.ts         # Space, SpaceMode, SpaceRole, CreateSpaceInput
├── infra/
│   └── spaces.repository.ts   # CRUD пространств, проверка ролей
├── application/
│   ├── listSpacesForUser.ts
│   ├── createSpace.ts
│   ├── renameSpace.ts
│   ├── deleteSpace.ts         # Защита от удаления последнего пространства
│   ├── setActiveSpaceForUser.ts
│   ├── ensureUserHasAtLeastOneSpace.ts
│   └── updateSpaceMode.ts     # Изменение режима (только OWNER)
└── api/
    ├── listSpacesEndpoint.ts
    ├── createSpaceEndpoint.ts
    ├── renameSpaceEndpoint.ts
    ├── deleteSpaceEndpoint.ts
    ├── setActiveSpaceEndpoint.ts
    └── updateSpaceModeEndpoint.ts
```

#### HTTP Routes
- `GET /api/spaces` — список пространств пользователя
- `POST /api/spaces` — создать пространство
- `PATCH /api/spaces/[id]` — переименовать пространство
- `DELETE /api/spaces/[id]` — удалить пространство (защита от удаления последнего)
- `POST /api/spaces/[id]/set-active` — установить активное пространство
- `PATCH /api/spaces/[id]/mode` — изменить режим пространства

#### Режимы Space

```typescript
enum SpaceMode {
  SESSIONS_ONLY        // Только видеосессии
  SESSIONS_AND_TASKS   // Сессии + задачи (в разработке)
}
```

#### Роли

```typescript
enum SpaceRole {
  OWNER   // Владелец (может удалять, менять режим)
  MEMBER  // Участник
}
```

#### Особенности
- **Защита от удаления последнего пространства** (`LAST_SPACE` error)
- **Автоматический выбор активного пространства** при удалении текущего
- **Проверка прав** (только OWNER может удалять, менять режим, переименовывать)

---

### 3. Sessions (`src/modules/core/sessions/`)

**Назначение**: Видеосессии с транскрипцией, привязанные к пространствам.

#### Структура

```
sessions/
├── domain/
│   └── session.types.ts       # Session, CreateSessionInput, ListSessionsBySpaceInput
├── infra/
│   ├── prisma/
│   │   ├── sessions.repository.ts      # CRUD сессий
│   │   └── transcripts.repository.ts    # Транскрипты
│   ├── livekit/
│   │   ├── token.service.ts             # Генерация LiveKit токенов
│   │   └── client-config.ts             # Конфигурация LiveKit клиента
│   ├── transcription/
│   │   ├── transcript.types.ts
│   │   ├── appendTranscriptChunk.ts     # Сохранение транскриптов в БД
│   │   ├── listSessionTranscripts.ts
│   │   ├── transcription-flags.ts        # Feature flags для транскрипции
│   │   ├── transcription-limits.ts      # Лимиты транскрипции
│   │   ├── transcription-metrics.ts     # Метрики транскрипции
│   │   ├── transcription-usage.repository.ts  # Репозиторий использования
│   │   └── transcription-usage.types.ts # Типы использования
│   └── participants/
│       └── participants.repository.ts   # Управление участниками
├── application/
│   ├── createSession.ts
│   ├── deleteSession.ts                 # Удаление сессии
│   ├── listSessionsBySpace.ts
│   ├── getSessionBySlug.ts
│   ├── endSession.ts
│   ├── upsertParticipantOnJoin.ts       # Создание/обновление участника при входе
│   ├── selectNewTranscriptionHost.ts     # Выбор нового host для транскрипции
│   └── saveTranscriptionUsage.ts        # Сохранение статистики использования
└── api/
    ├── createSessionEndpoint.ts
    ├── deleteSessionEndpoint.ts
    ├── listSessionsEndpoint.ts
    ├── upsertParticipantOnJoinEndpoint.ts
    ├── selectNewTranscriptionHostEndpoint.ts
    └── startTranscriptionServiceEndpoint.ts
```

#### HTTP Routes
- `GET /api/sessions` — список сессий активного пространства
- `POST /api/sessions` — создать сессию
- `DELETE /api/sessions/[slug]` — удалить сессию
- `GET /api/sessions/[slug]/token` — получить LiveKit токен для подключения
- `POST /api/sessions/[slug]/participants/join` — присоединиться к сессии как участник
- `GET /api/sessions/[slug]/participants/[identity]` — получить информацию об участнике
- `POST /api/sessions/[slug]/transcription-host` — выбрать нового host для транскрипции
- `POST /api/sessions/[slug]/transcription/start` — запустить транскрипцию
- `GET /api/sessions/[slug]/transcription/usage` — получить статистику использования транскрипции
- `POST /api/transcription/usage/save` — сохранить статистику использования
- `GET /api/transcription/stats` — получить общую статистику транскрипции

#### Особенности
- **Привязка к Space** через `spaceId`
- **LiveKit интеграция** для видеосвязи
- **Gladia транскрипция** через WebSocket сервер
- **Автоматическое создание участников** при входе в сессию
- **Designated transcription host** — один участник отвечает за транскрипцию
- **Feature flags** для управления транскрипцией
- **Лимиты и метрики** для отслеживания использования
- **Гостевой доступ** — возможность присоединиться без авторизации

---

### 4. Tasks (`src/modules/core/tasks/`)

**Назначение**: Task-менеджер (скелет, в разработке).

#### Структура

```
tasks/
├── domain/
│   └── task.types.ts          # Placeholder типы
├── application/
│   └── getTasksPlaceholder.ts  # Проверка режима Space
└── api/
    └── getTasksPlaceholderEndpoint.ts
```

#### HTTP Routes
- `GET /api/tasks` — placeholder endpoint (проверяет `SESSIONS_AND_TASKS` режим)

#### Особенности
- **Проверка режима Space** перед доступом
- **Заглушка** для будущей реализации

---

## База данных (Prisma Schema)

### Модели

#### User
```prisma
model User {
  id             String        @id @default(cuid())
  email          String        @unique
  name           String?
  displayName    String?
  avatarUrl      String?
  noAvatarColor  String?       # Пастельный цвет для аватара без фото
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  activeSpaceId  String?
  activeSpace    Space?        @relation("ActiveSpace", fields: [activeSpaceId], references: [id])

  sessions       Session[]     @relation("SessionsCreated")
  spaces         Space[]       @relation("SpacesOwned")
  spaceMembers   SpaceMember[]
  participants   Participant[]
}
```

#### Space
```prisma
model Space {
  id          String        @id @default(cuid())
  name        String
  ownerId     String
  owner       User          @relation("SpacesOwned", fields: [ownerId], references: [id])
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  mode        SpaceMode     @default(SESSIONS_ONLY)

  sessions    Session[]
  members     SpaceMember[]
  activeUsers User[]        @relation("ActiveSpace")
}
```

#### SpaceMember
```prisma
model SpaceMember {
  id        String    @id @default(cuid())
  spaceId   String
  space     Space     @relation(fields: [spaceId], references: [id])

  userId    String
  user      User      @relation(fields: [userId], references: [id])

  role      SpaceRole @default(OWNER)
  createdAt DateTime  @default(now())

  @@unique([spaceId, userId])
  @@index([spaceId])
  @@index([userId])
}
```

#### Session
```prisma
model Session {
  id              String          @id @default(cuid())
  slug            String          @unique
  title           String?
  createdByUserId String?
  createdBy       User?           @relation("SessionsCreated", fields: [createdByUserId], references: [id])
  status          SessionStatus   @default(ACTIVE)
  createdAt       DateTime        @default(now())
  endedAt         DateTime?

  spaceId         String
  space           Space           @relation(fields: [spaceId], references: [id])

  participants    Participant[]
  transcripts     TranscriptSegment[]

  @@index([spaceId])
  @@index([createdByUserId])
}
```

#### Participant
```prisma
model Participant {
  id            String            @id @default(cuid())
  sessionId     String
  session       Session           @relation(fields: [sessionId], references: [id])

  userId        String?
  user          User?             @relation(fields: [userId], references: [id])

  identity      String            # LiveKit identity
  name          String?
  role          ParticipantRole   @default(GUEST)
  joinedAt      DateTime          @default(now())
  leftAt        DateTime?

  transcripts   TranscriptSegment[]

  @@unique([sessionId, identity])
  @@index([sessionId])
}
```

#### TranscriptSegment
```prisma
model TranscriptSegment {
  id            String       @id @default(cuid())
  sessionId     String
  session       Session      @relation(fields: [sessionId], references: [id])

  participantId String?
  participant   Participant? @relation(fields: [participantId], references: [id])

  utteranceId   String       # Gladia data.id (для группировки)
  text          String
  language      String?
  isFinal       Boolean      @default(false)
  startedAt     DateTime
  endedAt       DateTime?
  createdAt     DateTime     @default(now())

  @@unique([sessionId, utteranceId])
  @@index([sessionId])
}
```

### Enums

```prisma
enum SpaceMode {
  SESSIONS_ONLY
  SESSIONS_AND_TASKS
}

enum SpaceRole {
  OWNER
  MEMBER
}

enum SessionStatus {
  ACTIVE
  ENDED
}

enum ParticipantRole {
  HOST
  GUEST
}
```

---

## WebSocket Server

### Структура (`ws/server/`)

```
ws/server/
├── index.ts                    # Точка входа, создание WebSocket сервера
├── client-connection.ts        # Обработка клиентских подключений
├── gladia-bridge.ts            # Интеграция с Gladia API
├── transcription-service.ts    # Сервис транскрипции
├── append-transcript-chunk.ts  # Сохранение транскриптов в БД (batch queue)
├── transcript-batch-queue.ts   # Batch-система для записи транскриптов
├── audio-validator.ts          # Валидация входящих аудио чанков
├── metrics.ts                  # Метрики WebSocket сервера
└── db.ts                       # Prisma Client для WebSocket сервера (singleton)
```

### Поток данных

1. **Клиент** → WebSocket сервер (`ws://host:port/api/realtime/transcribe?token=...`)
2. **WebSocket сервер** → Валидация аудио чанков (`audio-validator.ts`)
3. **WebSocket сервер** → Gladia API (инициализация сессии, пересылка аудио)
4. **Gladia** → WebSocket сервер (транскрипты)
5. **WebSocket сервер** → Batch очередь (`transcript-batch-queue.ts`) → БД (периодическая запись батчами)
6. **WebSocket сервер** → Клиент (транскрипты для отображения)

### HTTP Endpoints WebSocket сервера
- `GET /health` — health check
- `GET /metrics` — метрики сервера (количество подключений, транскриптов, длина очереди батча и т.д.)

### Оптимизации для высокой нагрузки (500-1000 пользователей)

#### 1. Singleton PrismaClient (`db.ts`)
- Использование `globalThis` для предотвращения создания множественных экземпляров
- Graceful shutdown: закрытие соединений при завершении процесса
- **Эффект**: Снижение нагрузки на БД за счет единого connection pool

#### 2. Batch-запись транскриптов (`transcript-batch-queue.ts`)
- In-memory очередь для pending транскриптов
- Периодическая запись батчами (по умолчанию каждые 300ms, до 100 элементов)
- Кэширование `sessionId` и `participantId` для снижения запросов к БД
- Использование `prisma.transcriptSegment.createMany` с `skipDuplicates: true`
- Обработка ошибок без падения процесса
- **Эффект**: Снижение нагрузки на БД в 10-50 раз (вместо N запросов делаем 1 запрос на батч)

#### 3. Запись только финальных сегментов
- В БД сохраняются только финальные транскрипты (`isFinal = true`)
- Partial-ы отправляются клиенту для UI, но не сохраняются в БД
- **Эффект**: Снижение нагрузки на БД в 50-100 раз (partial обновляются часто, финальные редко)

#### 4. Валидация аудио чанков (`audio-validator.ts`)
- Проверка размера чанков (предотвращение DoS)
- Rate limiting на клиент (максимальная частота отправки чанков)
- **Эффект**: Защита от злоупотреблений и атак

### Особенности
- **TypeScript** вместо JavaScript
- **Модульная структура** (client-connection, gladia-bridge, transcription-service)
- **Сохранение транскриптов в БД** через batch-очередь
- **Передача `utteranceId`** для правильной группировки на клиенте
- **JWT авторизация** через токен в query параметре
- **Метрики** для мониторинга работы сервера (очередь, flush, ошибки)
- **Отдельный Prisma schema** для WebSocket сервера
- **Graceful shutdown** с сохранением всех pending транскриптов

---

## UI Компоненты (`src/shared/ui/`)

### Дизайн-система

Все UI компоненты находятся в `src/shared/ui/` и не содержат бизнес-логики или fetch-запросов.

#### Компоненты

- **`avatar/Avatar.tsx`** — аватар с fallback (инициалы + цвет)
- **`button/Button.tsx`** — кнопка с вариантами (primary, secondary, ghost, danger)
- **`profile-menu/ProfileMenu.tsx`** — меню профиля с выходом
- **`space-switcher/SpaceSwitcher.tsx`** — переключатель пространств
- **`session-card/SessionCard.tsx`** — карточка сессии
- **`video-grid/VideoGrid.tsx`** — сетка видео участников (оптимизирована с React.memo)
- **`video-tile/VideoTile.tsx`** — отдельное видео участника (оптимизировано с React.memo)
- **`control-bar/ControlBar.tsx`** — панель управления (микрофон, камера, экран, выход)
- **`guest-join-gate/GuestJoinGate.tsx`** — форма для гостевого входа в сессию
- **`edit-profile-modal/`** — модальное окно редактирования профиля
- **`modal/`** — базовый компонент модального окна
- **`input/`** — компонент поля ввода
- **`transcript-bubble/TranscriptBubble.tsx`** — пузырь транскрипта (оптимизирован с React.memo)
- **`error-boundary/ErrorBoundary.tsx`** — обработчик ошибок React (интеграция с Sentry)

---

## Страницы

### `/sessions`
- **Server Component** — получает данные на сервере
- **SpaceSwitcher** — переключение между пространствами
- **Список SessionCard** — карточки сессий
- **Кнопка "Create session"** — создание новой сессии
- **Подсказка о Tasks** — если режим `SESSIONS_AND_TASKS`

### `/session/[slug]`
- **Client Component** — видеосессия с LiveKit
- **TranscriptProvider** — контекст для изоляции состояния транскрипции
- **GuestJoinGate** — форма для гостевого входа (если не авторизован)
- **VideoGrid** — отображение участников (оптимизировано)
- **ControlBar** — управление медиа
- **TranscriptSidebar** — real-time транскрипция (виртуализирована)
- **Hooks**:
  - `useRoom` — управление подключением к LiveKit комнате
  - `useParticipants` — управление участниками
  - `useLocalParticipantTranscription` — локальная транскрипция (для host)
  - `useTranscriptContext` — доступ к состоянию транскрипции (изолированному)
  - `useMediaControls` — управление медиа (микрофон, камера, экран)

### `/call/[slug]`
- **Legacy route** — старый путь для видеосессий (может быть удален)

### `/tasks`
- **Server Component** — проверка режима Space
- **Заглушка** — если режим `SESSIONS_AND_TASKS`
- **Redirect** — если режим `SESSIONS_ONLY`

---

## Hooks (`src/hooks/`)

### `useRoom.ts`
Управление подключением к LiveKit комнате:
- Создание и подключение к комнате
- Отслеживание состояния подключения
- Обработка переподключений

### `useParticipants.ts`
Управление участниками сессии:
- Получение локального участника
- Получение удаленных участников
- Отслеживание изменений участников

### `useLocalParticipantTranscription.ts`
Локальная транскрипция для transcription host:
- Управление AudioContext и AudioWorklet
- Подключение к WebSocket серверу транскрипции
- Обработка аудио потока и отправка на сервер
- Публикация транскриптов через LiveKit data channel

### `useTranscriptContext.tsx` (TranscriptContext)
Контекст для изоляции состояния транскрипции:
- Управление состоянием транскриптов через `Map<string, TranscriptBubbleState>` и `order: string[]`
- Обновление состояния с минимальными пересозданиями объектов
- Подписка на LiveKit data channel для получения транскриптов
- Мемоизация массива транскриптов для предотвращения лишних ре-рендеров
- **Эффект**: Обновления транскриптов не вызывают ре-рендеры VideoGrid и других компонентов

### `useMediaControls.ts`
Управление медиа-контролами (микрофон, камера, экран):
- Централизованное состояние и функции переключения
- Синхронизация с LiveKit треками
- Предотвращение дублирования логики

### `useTranscriptStream.ts` (legacy)
Получение транскриптов через LiveKit data channel (используется внутри TranscriptContext):
- Подписка на сообщения от других участников
- Группировка транскриптов по `utteranceId`
- Обновление UI в реальном времени

## Принципы архитектуры

### 1. Разделение слоев

- **`domain/`** — чистые типы и сущности, без зависимостей от Prisma/HTTP
- **`infra/`** — адаптеры: Prisma, LiveKit, Gladia, Cloudinary
- **`application/`** — бизнес-логика, use-cases
- **`api/`** — тонкий слой для HTTP endpoints

### 2. HTTP Routes (`app/api/**/route.ts`)

HTTP routes — тонкие адаптеры:
1. Получают `user` через `getCurrentUser()`
2. Парсят параметры (body, query, params)
3. Вызывают функции из `modules/core/*/api`
4. Возвращают `NextResponse`

**Нельзя**: писать бизнес-логику прямо в `route.ts`

### 3. UI Компоненты (`shared/ui/`)

- **Чистый UI** — без fetch, без бизнес-логики
- **Props-based** — все данные через props
- **Не знают** про Prisma, LiveKit, Gladia, spaceId и т.п.

### 4. Core-домены

- **`core/identity`** — пользователи, авторизация
- **`core/spaces`** — рабочие пространства
- **`core/sessions`** — видеосессии (включая LiveKit, Gladia внутри `infra/`)
- **`core/tasks`** — задачи (скелет)

### 5. Legacy модули

Legacy модули были удалены в процессе очистки проекта:
- ✅ `modules/livekit/` — удален, используется `core/sessions/infra/livekit/`
- ✅ `modules/participants/` — удален, используется `core/sessions/infra/participants/`
- ✅ `modules/sessions/` — удален, используется `core/sessions/`
- ✅ `modules/transcription/` — удален, используется `core/sessions/infra/transcription/`

**Статус**: Все legacy модули удалены, используется только архитектура `core/`.

### 6. Безопасность

#### Rate Limiting (`src/lib/rate-limit.ts`)
- Защита API endpoints от злоупотреблений
- Настраиваемые лимиты для разных типов запросов
- IP-based ограничения с окном времени
- **Защищенные endpoints**:
  - `/api/sessions` (GET, POST)
  - `/api/sessions/[slug]/token` (GET)
  - `/api/identity/profile` (PATCH)

#### Audio Chunk Validation (`ws/server/audio-validator.ts`)
- Валидация размера аудио чанков (предотвращение DoS)
- Rate limiting на клиент (максимальная частота отправки)
- Автоматическая очистка трекеров неактивных клиентов

### 7. Мониторинг и обработка ошибок

#### Sentry (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`)
- Интеграция Sentry для мониторинга ошибок
- Клиентская, серверная и edge конфигурации
- Автоматическое отслеживание ошибок и performance
- Фильтрация ошибок через `beforeSend` hooks

#### Error Boundary (`src/shared/ui/error-boundary/ErrorBoundary.tsx`)
- Глобальная обработка React ошибок
- Интеграция с Sentry для логирования
- Fallback UI при критических ошибках

### 8. Оптимизации производительности

#### Frontend
- **Виртуализация транскриптов**: Рендеринг только видимых элементов (30-50)
- **Изоляция состояния**: `TranscriptContext` предотвращает ре-рендеры VideoGrid
- **React.memo**: Оптимизация `VideoGrid`, `VideoTile`, `TranscriptBubble`
- **Map + order структура**: O(1) обновления состояния транскриптов

#### Backend
- **Batch-запись**: Снижение нагрузки на БД в 10-50 раз
- **Singleton PrismaClient**: Единый connection pool
- **Только финальные сегменты**: Снижение нагрузки в 50-100 раз

---

## Переменные окружения

```env
# Database
DATABASE_URL=

# NextAuth
NEXTAUTH_URL=
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# LiveKit
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=

# Gladia
GLADIA_API_KEY=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# WebSocket Server
WS_PORT=3001
NEXT_PUBLIC_WS_PORT=3001
NEXT_PUBLIC_WS_HOST=localhost
TRANSCRIPTION_JWT_SECRET=  # Секрет для JWT токенов транскрипции

# Transcription
NEXT_PUBLIC_TRANSCRIPTION_ENABLED=true

# Sentry (опционально)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=

# Prisma Logging (опционально, для debug)
PRISMA_LOG_QUERIES=false
```

---

## Скрипты

```json
{
  "dev": "next dev",
  "dev:ws": "tsx ws/server/index.ts",
  "build": "prisma generate && next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:watch": "vitest --watch",
  "load-test": "tsx load-test/ws-load-test.ts",
  "load-test:livekit": "bash load-test/livekit-load-test.sh",
  "postinstall": "prisma generate",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate dev",
  "db:generate": "prisma generate",
  "db:studio": "prisma studio"
}
```

### WebSocket Server

WebSocket сервер имеет отдельный `package.json` в `ws/` и может быть запущен независимо:
- `ws/server/index.ts` — точка входа
- Отдельный Prisma schema в `ws/prisma/schema.prisma`
- Dockerfile для деплоя (`ws/Dockerfile`)

---

## Миграции

### Примененные миграции

- `20241201120000_add_spaces_and_identity` — добавление Space, SpaceMember, обновление User, привязка Session к Space

### Особенности миграции

- **Сохранение данных** — существующие Session получили дефолтный Space
- **Автоматическое создание Space** для пользователей с сессиями
- **Установка activeSpaceId** для пользователей

---

## Будущие улучшения

1. **Task-менеджер** — полная реализация модуля `core/tasks`
2. **Онбординг** — выбор режима Space при создании первого пространства
3. **Навигация** — добавление пункта "Tasks" в меню при режиме `SESSIONS_AND_TASKS`
4. **Управление участниками** — приглашения, роли в пространствах
5. **Аналитика сессий** — статистика, экспорт транскриптов

---

## Документация

- **`docs/ARCHITECTURE_CURRENT.md`** — этот документ (текущая архитектура)
- **`docs/TESTING.md`** — руководство по тестированию (unit tests, load tests)
- **`docs/SENTRY_SETUP.md`** — настройка Sentry для мониторинга
- **`docs/CLEANUP_REPORT.md`** — отчет об очистке проекта
- **`docs/VERCEL_ENV_VARS.md`** — переменные окружения для Vercel
- **`docs/RENDER_SETUP.md`** — настройка WebSocket сервера на Render
- **`load-test/README_LIVEKIT.md`** — документация по LiveKit load test

---

## Транскрипция

### Архитектура транскрипции

1. **Designated Host** — один участник (обычно создатель сессии) отвечает за транскрипцию
2. **AudioWorklet** — обработка аудио на клиенте (16kHz, PCM16)
3. **WebSocket** — отправка аудио чанков на сервер транскрипции (с валидацией)
4. **Gladia API** — обработка аудио и генерация транскриптов
5. **LiveKit Data Channel** — распространение транскриптов всем участникам
6. **Batch Queue** — периодическая запись финальных транскриптов в БД
7. **Database** — сохранение транскриптов в БД для истории (только финальные)

### Frontend оптимизации транскрипции

#### Структура состояния (`src/types/transcript-state.ts`)
- **Map + order**: `byId: Map<string, TranscriptBubbleState>` для O(1) доступа
- **Минимальные пересоздания**: Обновляется только измененная запись в Map
- **Хронологический порядок**: Массив `order: string[]` с utteranceId

#### Изоляция состояния (`src/contexts/TranscriptContext.tsx`)
- **TranscriptProvider**: Изолирует состояние транскрипции от остального UI
- **Предотвращение ре-рендеров**: Обновления транскриптов не затрагивают VideoGrid
- **Мемоизация**: Массив транскриптов мемоизирован для эффективного рендеринга

#### Виртуализация (`src/components/call/TranscriptSidebar.tsx`)
- Рендеринг только видимых элементов (30-50)
- Lazy loading при скролле вверх
- **React.memo** для `TranscriptBubble` для предотвращения лишних ре-рендеров

### Backend оптимизации транскрипции

#### Batch-система (`ws/server/transcript-batch-queue.ts`)
- **In-memory очередь**: Накопление транскриптов перед записью
- **Периодическая запись**: Каждые 300ms, батчами до 100 элементов
- **Кэширование**: sessionId и participantId кэшируются для снижения запросов
- **Обработка ошибок**: Без падения процесса, с логированием
- **Эффект**: Снижение нагрузки на БД в 10-50 раз

#### Запись только финальных сегментов
- **Partial-ы**: Отправляются клиенту для UI, но не сохраняются в БД
- **Финальные**: Сохраняются в БД через batch-очередь
- **Эффект**: Снижение нагрузки на БД в 50-100 раз

### Feature Flags

Транскрипция управляется через feature flags:
- Глобальный флаг (`NEXT_PUBLIC_TRANSCRIPTION_ENABLED`)
- Лимиты на пользователя и сессию
- Максимальная длительность транскрипции

### Метрики

Отслеживание использования транскрипции:
- **Клиент**: Количество отправленных аудио чанков, полученных транскриптов
- **Сервер**: Количество подключений, длина очереди батча, flush операции
- **БД**: Всего добавлено в очередь, записано в БД, ошибки
- **Длительность транскрипции**
- **Ошибки**: Логирование и отправка в Sentry

## Тестирование

### Unit Tests (`vitest`)

**Критические компоненты покрыты тестами:**
- `src/lib/__tests__/rate-limit.test.ts` — rate limiting логика
- `ws/server/__tests__/audio-validator.test.ts` — валидация аудио чанков
- `src/modules/core/sessions/application/__tests__/createSession.test.ts` — создание сессий

### Load Tests

#### WebSocket транскрипция (`load-test/ws-load-test.ts`)
- Симуляция множественных подключений к WebSocket серверу
- Отправка аудио чанков, мониторинг транскриптов
- Метрики: очередь батча, память, ошибки

#### LiveKit синтетические участники (`load-test/livekit-load-test.sh`)
- Использование официального LiveKit CLI (`lk load-test`)
- Создание синтетических участников с видео/аудио
- Тестирование нагрузки на LiveKit сервер и UI отображения

**Документация**: см. `docs/TESTING.md` и `load-test/README_LIVEKIT.md`

---

*Последнее обновление: Декабрь 2024*

## История изменений

### Оптимизации (Декабрь 2024)

#### Backend
- ✅ Singleton PrismaClient для снижения нагрузки на БД
- ✅ Batch-система записи транскриптов (снижение нагрузки в 10-50 раз)
- ✅ Сохранение только финальных сегментов (снижение нагрузки в 50-100 раз)
- ✅ Валидация аудио чанков для защиты от DoS
- ✅ Graceful shutdown с сохранением всех pending транскриптов
- ✅ Расширенные метрики для мониторинга очереди и flush операций

#### Frontend
- ✅ Оптимизированная структура состояния транскриптов (Map + order)
- ✅ TranscriptContext для изоляции состояния от остального UI
- ✅ Виртуализация списка транскриптов (рендеринг только видимых элементов)
- ✅ React.memo для критических компонентов (VideoGrid, VideoTile, TranscriptBubble)
- ✅ useMediaControls для централизации логики управления медиа

#### Безопасность
- ✅ Rate limiting для критических API endpoints
- ✅ Валидация аудио чанков на WebSocket сервере

#### Мониторинг
- ✅ Интеграция Sentry для отслеживания ошибок
- ✅ ErrorBoundary для обработки React ошибок
- ✅ Расширенные метрики WebSocket сервера

#### Тестирование
- ✅ Unit tests для критических компонентов (rate-limit, audio-validator, createSession)
- ✅ Load tests для WebSocket сервера и LiveKit
- ✅ Интеграция с официальным LiveKit CLI для синтетических участников

#### Очистка
- ✅ Удалены legacy модули (`modules/livekit/`, `modules/participants/`, и т.д.)
- ✅ Удалены неиспользуемые файлы и компоненты
- ✅ Улучшена структура проекта и документация



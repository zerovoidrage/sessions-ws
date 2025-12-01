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
├── append-transcript-chunk.ts  # Сохранение транскриптов в БД
├── metrics.ts                  # Метрики WebSocket сервера
└── db.ts                       # Prisma Client для WebSocket сервера
```

### Поток данных

1. **Клиент** → WebSocket сервер (`ws://host:port/api/realtime/transcribe?token=...`)
2. **WebSocket сервер** → Gladia API (инициализация сессии, пересылка аудио)
3. **Gladia** → WebSocket сервер (транскрипты)
4. **WebSocket сервер** → БД (сохранение транскриптов через `append-transcript-chunk`)
5. **WebSocket сервер** → Клиент (транскрипты для отображения)

### HTTP Endpoints WebSocket сервера
- `GET /health` — health check
- `GET /metrics` — метрики сервера (количество подключений, транскриптов и т.д.)

### Особенности
- **TypeScript** вместо JavaScript
- **Модульная структура** (client-connection, gladia-bridge, transcription-service)
- **Сохранение транскриптов в БД** через `append-transcript-chunk`
- **Передача `utteranceId`** для правильной группировки на клиенте
- **JWT авторизация** через токен в query параметре
- **Метрики** для мониторинга работы сервера
- **Отдельный Prisma schema** для WebSocket сервера

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
- **`video-grid/VideoGrid.tsx`** — сетка видео участников
- **`video-tile/VideoTile.tsx`** — отдельное видео участника
- **`control-bar/ControlBar.tsx`** — панель управления (микрофон, камера, экран, выход)
- **`guest-join-gate/GuestJoinGate.tsx`** — форма для гостевого входа в сессию
- **`edit-profile-modal/`** — модальное окно редактирования профиля
- **`modal/`** — базовый компонент модального окна
- **`input/`** — компонент поля ввода

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
- **GuestJoinGate** — форма для гостевого входа (если не авторизован)
- **VideoGrid** — отображение участников
- **ControlBar** — управление медиа
- **TranscriptSidebar** — real-time транскрипция
- **Hooks**:
  - `useRoom` — управление подключением к LiveKit комнате
  - `useParticipants` — управление участниками
  - `useLocalParticipantTranscription` — локальная транскрипция (для host)
  - `useTranscriptStream` — получение транскриптов через LiveKit data channel

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

### `useTranscriptStream.ts`
Получение транскриптов через LiveKit data channel:
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

В `src/modules/` есть дублирующие модули вне `core/`:
- `modules/livekit/` — legacy, должен быть в `core/sessions/infra/livekit/`
- `modules/participants/` — legacy, должен быть в `core/sessions/infra/participants/`
- `modules/sessions/` — legacy, должен быть в `core/sessions/`
- `modules/transcription/` — legacy, должен быть в `core/sessions/infra/transcription/`

**Рекомендация**: использовать только модули из `core/`, legacy модули могут быть удалены в будущем.

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
NEXT_PUBLIC_LIVEKIT_WS_URL=

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

# Transcription
NEXT_PUBLIC_TRANSCRIPTION_ENABLED=true
```

---

## Скрипты

```json
{
  "dev": "next dev",
  "dev:ws": "tsx ws/server/index.ts",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
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

- **`docs/ARCHITECTURE.md`** — общая архитектура проекта (legacy)
- **`docs/GLADIA_INTEGRATION.md`** — интеграция с Gladia
- **`docs/ARCHITECTURE_CURRENT.md`** — этот документ (текущая архитектура)

---

## Транскрипция

### Архитектура транскрипции

1. **Designated Host** — один участник (обычно создатель сессии) отвечает за транскрипцию
2. **AudioWorklet** — обработка аудио на клиенте (16kHz, PCM16)
3. **WebSocket** — отправка аудио чанков на сервер транскрипции
4. **Gladia API** — обработка аудио и генерация транскриптов
5. **LiveKit Data Channel** — распространение транскриптов всем участникам
6. **Database** — сохранение транскриптов в БД для истории

### Feature Flags

Транскрипция управляется через feature flags:
- Глобальный флаг (`NEXT_PUBLIC_TRANSCRIPTION_ENABLED`)
- Лимиты на пользователя и сессию
- Максимальная длительность транскрипции

### Метрики

Отслеживание использования транскрипции:
- Количество отправленных аудио чанков
- Количество полученных транскриптов (partial/final)
- Длительность транскрипции
- Ошибки

---

*Последнее обновление: Декабрь 2024*



# Rooms / Sessions — Архитектура проекта

## Обзор

**Rooms / Sessions** — веб-приложение для видеосессий с real-time транскрипцией речи. Проект построен на Next.js 14 с модульной архитектурой, разделенной на core-домены. Поддерживает создание рабочих пространств (spaces), видеосессий с участниками и автоматическую транскрипцию речи в реальном времени.

---

## Технологический стек

### Frontend
- **Next.js 14** (App Router) — React-фреймворк
- **React 18** + **TypeScript** — UI и типизация
- **Tailwind CSS** — стилизация с кастомными токенами
- **Phosphor Icons** — иконки
- **LiveKit Client SDK** (`@livekit/components-react`) — видеосвязь и WebRTC

### Backend
- **Next.js API Routes** (`app/api/**/route.ts`) — HTTP endpoints
- **Prisma ORM** + **PostgreSQL** (Neon) — база данных
- **NextAuth.js v4** — аутентификация (Google OAuth)
- **Node.js WebSocket Server** (TypeScript, `ws`) — real-time транскрипция

### Внешние сервисы
- **LiveKit** — видеосвязь, WebRTC, управление участниками
- **Gladia** — real-time транскрипция речи
- **Cloudinary** — загрузка и хранение аватаров пользователей

---

## Архитектура модулей

### Структура `src/modules/core/`

Проект использует модульную архитектуру с разделением на core-домены:

```
src/modules/core/
├── identity/          # Авторизация и профиль пользователя
├── spaces/            # Рабочие пространства
├── sessions/          # Видеосессии, участники, транскрипция
└── tasks/             # Task-менеджер (скелет, в разработке)
```

### Единообразная структура модулей

Каждый core-модуль имеет одинаковую структуру:

```
<module>/
├── domain/            # Доменные типы и сущности (без Prisma/HTTP)
├── infra/             # Инфраструктура: Prisma, внешние сервисы
├── application/       # Бизнес-логика, use-cases
└── api/               # API endpoints (вызываются из app/api)
```

**Принципы:**
- **`domain/`** — чистые типы и сущности, без зависимостей от Prisma/HTTP
- **`infra/`** — адаптеры: Prisma, LiveKit, Gladia, Cloudinary (без бизнес-логики)
- **`application/`** — бизнес-правила и последовательности действий
- **`api/`** — тонкий слой: принимает аргументы, вызывает application, обрабатывает ошибки

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

#### Функции

- **Аутентификация**: Google OAuth через NextAuth.js
- **Профиль пользователя**: имя, email, displayName, avatarUrl, noAvatarColor
- **Активное пространство**: каждый пользователь имеет `activeSpaceId`
- **Автоматическая генерация `noAvatarColor`**: пастельные цвета на основе email (детерминированный hash)
- **Загрузка аватаров**: подпись Cloudinary для безопасной загрузки

#### HTTP Routes
- `GET /api/identity/profile` — получить профиль
- `PATCH /api/identity/profile` — обновить профиль
- `GET /api/identity/avatar/sign` — получить подпись для загрузки аватара
- `GET/POST /api/auth/[...nextauth]` — NextAuth endpoints

---

### 2. Spaces (`src/modules/core/spaces/`)

**Назначение**: Рабочие пространства (spaces) — контейнеры для сессий и задач.

#### Структура

```
spaces/
├── domain/
│   └── space.types.ts         # Space, CreateSpaceInput, SpaceMode, SpaceRole
├── infra/
│   └── spaces.repository.ts    # CRUD пространств через Prisma
├── application/
│   ├── createSpace.ts          # Создание пространства
│   ├── listSpacesForUser.ts   # Список пространств пользователя
│   ├── renameSpace.ts          # Переименование
│   ├── deleteSpace.ts          # Удаление
│   ├── updateSpaceMode.ts      # Изменение режима (SESSIONS_ONLY / SESSIONS_AND_TASKS)
│   ├── setActiveSpaceForUser.ts # Установка активного пространства
│   └── ensureUserHasAtLeastOneSpace.ts # Гарантия наличия хотя бы одного пространства
└── api/
    ├── createSpaceEndpoint.ts
    ├── listSpacesEndpoint.ts
    ├── renameSpaceEndpoint.ts
    ├── deleteSpaceEndpoint.ts
    ├── updateSpaceModeEndpoint.ts
    └── setActiveSpaceEndpoint.ts
```

#### Функции

- **Режимы пространств**:
  - `SESSIONS_ONLY` — только видеосессии
  - `SESSIONS_AND_TASKS` — сессии + task-менеджер (в разработке)
- **Участники пространства**: `SpaceMember` с ролями (OWNER, MEMBER)
- **Активное пространство**: пользователь может иметь одно активное пространство
- **Автоматическое создание**: при первом входе создается пространство по умолчанию

#### HTTP Routes
- `POST /api/spaces` — создать пространство
- `GET /api/spaces` — список пространств пользователя
- `PATCH /api/spaces/[id]` — переименовать пространство
- `DELETE /api/spaces/[id]` — удалить пространство
- `PATCH /api/spaces/[id]/mode` — изменить режим
- `POST /api/spaces/[id]/set-active` — установить активным

---

### 3. Sessions (`src/modules/core/sessions/`)

**Назначение**: Видеосессии, участники, транскрипция.

#### Структура

```
sessions/
├── domain/
│   └── session.types.ts       # Session, CreateSessionInput, SessionStatus
├── infra/
│   ├── prisma/
│   │   ├── sessions.repository.ts    # CRUD сессий
│   │   └── transcripts.repository.ts # CRUD транскриптов
│   ├── participants/
│   │   └── participants.repository.ts # CRUD участников
│   ├── livekit/
│   │   ├── token.service.ts   # Генерация LiveKit токенов
│   │   └── client-config.ts   # Конфигурация LiveKit клиента
│   └── transcription/
│       ├── appendTranscriptChunk.ts   # Добавление транскрипта в БД
│       ├── listSessionTranscripts.ts  # Список транскриптов сессии
│       └── transcript.types.ts        # TranscriptSegment, AppendTranscriptChunkInput
├── application/
│   ├── createSession.ts       # Создание сессии
│   ├── getSessionBySlug.ts    # Получение сессии по slug
│   ├── listSessionsBySpace.ts # Список сессий пространства
│   └── endSession.ts          # Завершение сессии
└── api/
    ├── createSessionEndpoint.ts
    └── listSessionsEndpoint.ts
```

#### Функции

- **Видеосессии**: создание, получение, список, завершение
- **Участники**: отслеживание участников через LiveKit identity
- **Транскрипция**: real-time транскрипция речи через Gladia
- **LiveKit интеграция**: генерация токенов для подключения к видеосессии
- **Хранение транскриптов**: все транскрипты сохраняются в БД (`TranscriptSegment`)

#### HTTP Routes
- `POST /api/sessions` — создать сессию
- `GET /api/sessions` — список сессий активного пространства
- `GET /api/sessions/[slug]/token` — получить LiveKit токен для подключения

#### WebSocket Server (`ws/server/`)

Отдельный Node.js сервер для real-time транскрипции:

```
ws/server/
├── index.ts              # WebSocket сервер (порт 3001)
├── client-connection.ts  # Обработка подключений клиентов
├── gladia-bridge.ts      # Мост между клиентом и Gladia
└── db.ts                 # Prisma клиент для БД
```

**Поток данных:**
1. Клиент подключается к WebSocket (`ws://localhost:3001/api/realtime/transcribe`)
2. Отправляет `sessionSlug` и `participantIdentity`
3. Сервер создает Gladia сессию
4. Клиент отправляет аудио (PCM, 16kHz)
5. Gladia возвращает транскрипты
6. Сервер сохраняет транскрипты в БД через `appendTranscriptChunk`
7. Сервер отправляет транскрипты обратно клиенту

---

### 4. Tasks (`src/modules/core/tasks/`)

**Назначение**: Task-менеджер (скелет, в разработке).

#### Структура

```
tasks/
├── domain/
│   └── task.types.ts     # Placeholder типы
├── application/
│   └── getTasksPlaceholder.ts
└── api/
    └── getTasksPlaceholderEndpoint.ts
```

**Статус**: Модуль находится в стадии планирования. Реализован только placeholder.

---

## Схема базы данных

### Модели Prisma

#### User
- `id`, `email` (unique), `name`, `displayName`, `avatarUrl`, `noAvatarColor`
- `activeSpaceId` — активное пространство
- Связи: `videoSessions`, `spaces`, `spaceMembers`, `participants`
- NextAuth: `accounts`, `sessions`

#### Space
- `id`, `name`, `ownerId`, `mode` (SESSIONS_ONLY | SESSIONS_AND_TASKS)
- Связи: `videoSessions`, `members`, `activeUsers`

#### SpaceMember
- `id`, `spaceId`, `userId`, `role` (OWNER | MEMBER)
- Unique: `[spaceId, userId]`

#### VideoSession
- `id`, `slug` (unique), `title`, `createdByUserId`, `status` (ACTIVE | ENDED)
- `spaceId`, `createdAt`, `endedAt`
- Связи: `participants`, `transcripts`

#### Participant
- `id`, `videoSessionId`, `userId`, `identity` (LiveKit identity)
- `name`, `role` (HOST | GUEST), `joinedAt`, `leftAt`
- Unique: `[videoSessionId, identity]`

#### TranscriptSegment
- `id`, `videoSessionId`, `participantId`, `utteranceId` (Gladia data.id)
- `text`, `language`, `isFinal`, `startedAt`, `endedAt`, `createdAt`
- Unique: `[videoSessionId, utteranceId]`

#### NextAuth модели
- **Account**: OAuth аккаунты (Google)
- **Session**: сессии авторизации NextAuth
- **VerificationToken**: токены верификации

---

## API Endpoints

### Identity
- `GET /api/identity/profile` — получить профиль текущего пользователя
- `PATCH /api/identity/profile` — обновить профиль
- `GET /api/identity/avatar/sign` — получить подпись Cloudinary для загрузки аватара

### Spaces
- `POST /api/spaces` — создать пространство
- `GET /api/spaces` — список пространств пользователя
- `PATCH /api/spaces/[id]` — переименовать пространство
- `DELETE /api/spaces/[id]` — удалить пространство
- `PATCH /api/spaces/[id]/mode` — изменить режим пространства
- `POST /api/spaces/[id]/set-active` — установить пространство активным

### Sessions
- `POST /api/sessions` — создать видеосессию
- `GET /api/sessions` — список сессий активного пространства
- `GET /api/sessions/[slug]/token` — получить LiveKit токен для подключения

### Tasks
- `GET /api/tasks` — placeholder endpoint

### Auth
- `GET/POST /api/auth/[...nextauth]` — NextAuth endpoints (signin, callback, session, etc.)

---

## Frontend компоненты

### Страницы (`src/app/`)

#### `/sessions`
- Server Component
- Отображает список видеосессий активного пространства
- `SpaceSwitcher` — переключение между пространствами
- Кнопка создания новой сессии

#### `/session/[slug]`
- Client Component
- Видеосессия с LiveKit
- `VideoGrid` — сетка участников
- `ControlBar` — управление медиа (микрофон, камера, экран, выход)
- `TranscriptSidebar` — real-time транскрипция

#### `/tasks`
- Server Component
- Placeholder для task-менеджера
- Проверка режима пространства

### UI компоненты (`src/shared/ui/`)

Все компоненты в `shared/ui` — чистые UI компоненты без бизнес-логики:

- **`avatar/Avatar.tsx`** — аватар пользователя
- **`button/index.tsx`** — кнопка с кастомными стилями
- **`profile-menu/ProfileMenu.tsx`** — меню профиля с выходом
- **`space-switcher/SpaceSwitcher.tsx`** — переключатель пространств
- **`session-card/SessionCard.tsx`** — карточка сессии
- **`video-grid/VideoGrid.tsx`** — сетка видео участников
- **`video-tile/VideoTile.tsx`** — отдельное видео участника
- **`control-bar/ControlBar.tsx`** — панель управления (микрофон, камера, экран, выход)

### React Hooks (`src/hooks/`)

- **`useRoom.ts`** — управление LiveKit Room (подключение, отключение, участники)
- **`useLocalParticipantTranscription.ts`** — захват аудио локального участника и отправка на WebSocket сервер
- **`useTranscriptStream.ts`** — обработка транскриптов из LiveKit Data Channels и WebSocket

---

## Интеграции

### LiveKit

**Назначение**: Видеосвязь, WebRTC, управление участниками.

**Использование:**
- Генерация токенов для подключения к комнате (`token.service.ts`)
- Клиентский SDK для отображения видео и управления медиа
- Data Channels для передачи транскриптов между участниками

**Конфигурация:**
- `LIVEKIT_URL` — URL LiveKit сервера
- `LIVEKIT_API_KEY` — API ключ
- `LIVEKIT_API_SECRET` — API секрет

### Gladia

**Назначение**: Real-time транскрипция речи.

**Использование:**
- WebSocket сервер (`ws/server/gladia-bridge.ts`) создает Gladia сессию
- Клиент отправляет аудио (PCM, 16kHz) на WebSocket сервер
- Сервер проксирует аудио в Gladia
- Gladia возвращает транскрипты (interim и final)
- Сервер сохраняет транскрипты в БД и отправляет клиенту

**Конфигурация:**
- `GLADIA_API_KEY` — API ключ Gladia

### Cloudinary

**Назначение**: Загрузка и хранение аватаров пользователей.

**Использование:**
- Генерация подписи для безопасной загрузки (`cloudinary.ts`)
- Клиент загружает аватар напрямую в Cloudinary
- URL аватара сохраняется в профиле пользователя

**Конфигурация:**
- `CLOUDINARY_CLOUD_NAME` — имя облака
- `CLOUDINARY_API_KEY` — API ключ
- `CLOUDINARY_API_SECRET` — API секрет

### NextAuth.js

**Назначение**: Аутентификация через Google OAuth.

**Конфигурация:**
- `NEXTAUTH_SECRET` — секретный ключ
- `NEXTAUTH_URL` — URL приложения
- `GOOGLE_CLIENT_ID` — Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth Client Secret

**Модели БД:**
- `Account` — OAuth аккаунты
- `Session` — сессии авторизации
- `VerificationToken` — токены верификации

---

## Потоки данных

### Создание и подключение к видеосессии

1. Пользователь создает сессию → `POST /api/sessions`
2. Сервер создает `VideoSession` в БД с уникальным `slug`
3. Пользователь открывает `/session/[slug]`
4. Клиент запрашивает LiveKit токен → `GET /api/sessions/[slug]/token`
5. Сервер генерирует токен через `token.service.ts`
6. Клиент подключается к LiveKit Room
7. Клиент подключается к WebSocket серверу для транскрипции

### Real-time транскрипция

1. Клиент захватывает аудио локального участника
2. Аудио отправляется на WebSocket сервер (`ws://localhost:3001/api/realtime/transcribe`)
3. WebSocket сервер создает Gladia сессию (если еще не создана)
4. Сервер проксирует аудио в Gladia
5. Gladia возвращает транскрипты (interim и final)
6. Сервер сохраняет транскрипты в БД через `appendTranscriptChunk`
7. Сервер отправляет транскрипты обратно клиенту
8. Клиент отображает транскрипты в `TranscriptSidebar`
9. Транскрипты также публикуются в LiveKit Data Channels для других участников

---

## Принципы архитектуры

### 1. Разделение слоев

- **Domain** — чистые типы и сущности, без зависимостей
- **Infrastructure** — адаптеры внешних сервисов, без бизнес-логики
- **Application** — бизнес-правила и use-cases
- **API** — тонкий слой для HTTP endpoints

### 2. HTTP Routes

HTTP routes (`app/api/**/route.ts`) — тонкие адаптеры:
1. Получают `user` через `getCurrentUser()`
2. Парсят параметры (body, query, params)
3. Вызывают функции из `modules/core/*/api`
4. Обрабатывают ошибки и возвращают `NextResponse`

### 3. UI компоненты

Компоненты в `shared/ui`:
- Не делают fetch запросы
- Не содержат бизнес-логику
- Получают все данные через props
- Не знают про Prisma, LiveKit, Gladia

### 4. Модульность

- Каждый core-модуль изолирован
- Модули взаимодействуют через четко определенные интерфейсы
- Инфраструктура (LiveKit, Gladia) находится внутри модуля `sessions`, а не на верхнем уровне

---

## Скрипты

```bash
npm run dev          # Запуск Next.js dev сервера
npm run dev:ws       # Запуск WebSocket сервера для транскрипции
npm run build        # Сборка production
npm run start        # Запуск production сервера
npm run lint         # Проверка кода ESLint
npm run db:push      # Применить изменения схемы Prisma к БД
npm run db:migrate   # Создать миграцию
npm run db:generate  # Сгенерировать Prisma Client
npm run db:studio    # Открыть Prisma Studio
```

---

## Переменные окружения

### База данных
- `DATABASE_URL` — PostgreSQL connection string (Neon)

### NextAuth
- `NEXTAUTH_SECRET` — секретный ключ для NextAuth
- `NEXTAUTH_URL` — URL приложения
- `GOOGLE_CLIENT_ID` — Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth Client Secret

### LiveKit
- `LIVEKIT_URL` — URL LiveKit сервера
- `LIVEKIT_API_KEY` — API ключ
- `LIVEKIT_API_SECRET` — API секрет

### Gladia
- `GLADIA_API_KEY` — API ключ Gladia

### Cloudinary
- `CLOUDINARY_CLOUD_NAME` — имя облака
- `CLOUDINARY_API_KEY` — API ключ
- `CLOUDINARY_API_SECRET` — API секрет

### WebSocket сервер
- `WS_PORT` — порт WebSocket сервера (по умолчанию 3001)

---

## Будущие улучшения

1. **Task-менеджер**: реализация модуля `tasks` для управления задачами
2. **Уведомления**: система уведомлений для участников сессий
3. **Запись сессий**: возможность записи видеосессий
4. **Аналитика**: статистика по сессиям и участникам
5. **Мобильное приложение**: React Native версия

---

## Примечания

- Проект следует принципам Clean Architecture и Domain-Driven Design
- Все внешние зависимости изолированы в слое `infra`
- Бизнес-логика находится в слое `application`
- UI компоненты не содержат бизнес-логику
- HTTP routes — тонкие адаптеры, делегирующие работу модулям

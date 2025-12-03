# Структура проекта

Полное описание структуры проекта: папки, модули, файлы и их назначение.

---

## Корневая структура

```
rooms/
├── docs/                    # Документация проекта
├── prisma/                  # Prisma схема и миграции
├── public/                  # Статические файлы (Next.js)
├── server/                  # WS/RTMP монолитный сервер
├── src/                     # Next.js приложение (фронтенд + API)
├── ws/                      # Legacy WS сервер (deprecated)
├── ws-server/               # Legacy WS сервер (deprecated)
├── Dockerfile               # Docker для Next.js
├── Dockerfile.ws            # Docker для WS/RTMP сервера
├── vercel.json              # Конфигурация Vercel (cron jobs)
├── railway.json             # Конфигурация Railway
├── package.json             # Зависимости и скрипты
├── tsconfig.json            # TypeScript конфигурация
└── tailwind.config.ts       # Tailwind CSS конфигурация
```

---

## `/docs` — Документация

**Назначение:** Вся техническая документация проекта.

**Файлы:**
- `LIVE_STREAMING_ARCHITECTURE.md` — архитектура live streaming и транскрипции
- `REALTIME_CORE_IMPLEMENTATION.md` — реализация Realtime Core
- `TRANSCRIPTION_METRICS.md` — метрики транскрипции
- `LATENCY_METRICS_IMPROVEMENTS.md` — улучшения метрик латентности
- `TESTING_AND_METRICS.md` — тестирование и метрики
- `SESSIONS_MODULE_ARCHITECTURE.md` — архитектура модуля сессий
- `SESSION_LIFECYCLE.md` — жизненный цикл сессий
- `PROJECT_STRUCTURE.md` — этот файл

---

## `/prisma` — База данных

**Назначение:** Prisma схема и миграции базы данных.

**Структура:**
```
prisma/
├── schema.prisma            # Prisma схема (модели, enum'ы)
└── migrations/              # Миграции БД
    ├── 20241201000000_rename_callroom_to_session/
    ├── 20241201120000_add_spaces_and_identity/
    ├── 20241203150000_add_session_end_reason_and_metadata/
    └── 20241215000000_add_session_lifecycle_and_analysis/
```

**Модели:**
- `User` — пользователи
- `Space` — рабочие пространства
- `VideoSession` — видеосессии
- `Participant` — участники сессий
- `TranscriptSegment` — сегменты транскриптов
- `TranscriptionUsage` — учет использования транскрипции
- `SessionAnalysis` — AI-анализ сессий

---

## `/public` — Статические файлы

**Назначение:** Статические ресурсы для Next.js (доступны по `/`).

**Структура:**
```
public/
├── fonts/                   # Шрифты (Suisse Intl)
├── img/                     # Изображения (логотипы, favicon)
├── audio/                   # Аудио файлы
└── sessions.ai.pdf          # Документация
```

---

## `/server` — WS/RTMP Монолитный сервер

**Назначение:** Монолитный сервер для realtime транскрипции (RTMP + FFmpeg + Gladia + WebSocket).

**Расположение:** Корень проекта (не в `src/`)

**Файлы:**

### Основные модули

- **`index.ts`** — точка входа сервера
  - HTTP сервер для API endpoints
  - WebSocket сервер для клиентов
  - RTMP сервер для приема потоков
  - Метрики endpoint (`/metrics`)

- **`rtmp-server.ts`** — глобальный RTMP сервер
  - Прием RTMP потоков от LiveKit Egress
  - Управление потоками по `sessionSlug`

- **`rtmp-ingest.ts`** — обработчик RTMP для одной сессии
  - FFmpeg декодирование (RTMP → PCM16)
  - Отправка аудио в Gladia
  - Получение транскриптов от Gladia
  - Broadcast транскриптов клиентам
  - Фильтр галлюцинаций

- **`gladia-bridge.ts`** — WebSocket клиент для Gladia Live v2
  - Подключение к Gladia
  - Отправка PCM16 аудио
  - Получение транскриптов
  - Метрики latency

- **`client-connection.ts`** — управление WebSocket подключениями клиентов
  - Хранение подключений по `sessionSlug`
  - Broadcast сообщений клиентам

### Вспомогательные модули

- **`active-speaker-tracker.ts`** — отслеживание активного спикера
- **`append-transcript-chunk.ts`** — сохранение транскриптов в БД
- **`realtime-metrics.ts`** — метрики latency и counters
- **`metrics.ts`** — общие метрики сервера
- **`livekit-transcriber.ts`** — управление LiveKit транскрипцией
- **`livekit-room-composite-transcriber.ts`** — Room Composite Egress
- **`transcript-batch-queue.ts`** — очередь для батчинга транскриптов
- **`transcription-service.ts`** — сервис транскрипции
- **`types.ts`** — типы для сервера
- **`db.ts`** — Prisma client для сервера
- **`env.ts`** — переменные окружения

### Тесты

- **`__tests__/audio-validator.test.ts`** — тесты валидации аудио

---

## `/src` — Next.js Приложение

**Назначение:** Frontend и API endpoints для Next.js.

**Структура:**
```
src/
├── app/                     # Next.js App Router (страницы + API)
├── components/              # React компоненты
├── contexts/                # React контексты
├── hooks/                   # React хуки
├── lib/                     # Утилиты и библиотеки
├── modules/                 # Бизнес-логика (Clean Architecture)
├── shared/                  # Общие компоненты
└── types/                   # TypeScript типы
```

---

## `/src/app` — Next.js App Router

**Назначение:** Страницы и API routes (Next.js 14 App Router).

### Страницы (`/src/app`)

- **`page.tsx`** — главная страница (landing)
- **`layout.tsx`** — корневой layout
- **`globals.css`** — глобальные стили

### Страницы приложения

- **`/auth/signin/page.tsx`** — страница входа
- **`/onboarding/page.tsx`** — онбординг пользователя
- **`/sessions/page.tsx`** — список сессий
- **`/call/[slug]/page.tsx`** — страница видеозвонка
- **`/session/[slug]/page.tsx`** — страница сессии (альтернативный роут)
- **`/tasks/page.tsx`** — страница задач (placeholder)

### API Routes (`/src/app/api`)

#### `/api/auth/[...nextauth]/route.ts`
- NextAuth.js endpoints для аутентификации

#### `/api/cron/`
- **`auto-end-sessions/route.ts`** — cron job для автозавершения неактивных сессий
- **`expire-sessions/route.ts`** — cron job для истечения протухших сессий

#### `/api/identity/`
- **`avatar/sign/route.ts`** — получение подписи для загрузки аватара
- **`profile/route.ts`** — получение/обновление профиля

#### `/api/sessions/`
- **`route.ts`** — `GET` (список), `POST` (создание)
- **`[slug]/route.ts`** — `DELETE` (удаление)
- **`[slug]/end/route.ts`** — `POST` (завершение)
- **`[slug]/token/route.ts`** — `GET` (LiveKit токен)
- **`[slug]/participants/route.ts`** — `GET` (список участников)
- **`[slug]/participants/join/route.ts`** — `POST` (регистрация участника)
- **`[slug]/participants/[identity]/route.ts`** — `GET` (данные участника)
- **`[slug]/transcription/start/route.ts`** — `POST` (запуск транскрипции)
- **`[slug]/transcription/usage/route.ts`** — `GET` (метрики использования)
- **`[slug]/transcription-host/route.ts`** — выбор хоста транскрипции
- **`kill-all/route.ts`** — `DELETE` (удаление всех сессий, dev only)

#### `/api/spaces/`
- **`route.ts`** — `GET` (список), `POST` (создание)
- **`[id]/route.ts`** — `DELETE` (удаление)
- **`[id]/mode/route.ts`** — `PATCH` (обновление режима)
- **`[id]/set-active/route.ts`** — `POST` (установка активного пространства)

#### `/api/tasks/`
- **`route.ts`** — `GET` (placeholder)

#### `/api/transcription/`
- **`stats/route.ts`** — статистика транскрипции
- **`usage/save/route.ts`** — сохранение метрик использования

---

## `/src/modules` — Бизнес-логика (Clean Architecture)

**Назначение:** Модульная архитектура с разделением на слои.

**Принцип:** Каждый модуль имеет структуру:
- `domain/` — типы и доменные правила (без зависимостей)
- `application/` — use cases (бизнес-логика)
- `infra/` — адаптеры (Prisma, внешние сервисы)
- `api/` — HTTP endpoints (тонкий слой)

### `/src/modules/core` — Core домены

#### `identity/` — Пользователи и авторизация

```
identity/
├── domain/
│   └── user.types.ts           # Типы User, DomainUser
├── application/
│   ├── getCurrentUser.ts       # Получение текущего пользователя
│   ├── updateProfile.ts         # Обновление профиля
│   ├── setActiveSpace.ts        # Установка активного пространства
│   ├── ensureUserHasActiveSpace.ts
│   └── isOnboardingCompleted.ts
├── infra/
│   ├── auth.config.ts          # NextAuth конфигурация
│   ├── cloudinary.ts            # Cloudinary для аватаров
│   └── user.repository.ts     # Prisma репозиторий пользователей
└── api/
    ├── getProfileEndpoint.ts
    ├── updateProfileEndpoint.ts
    └── getAvatarUploadSignatureEndpoint.ts
```

#### `sessions/` — Видеосессии

```
sessions/
├── domain/
│   └── session.types.ts        # Типы Session, SessionStatus, SessionEndReason
├── application/
│   ├── createSession.ts         # Создание сессии
│   ├── endSession.ts           # Завершение сессии
│   ├── deleteSession.ts        # Удаление сессии
│   ├── getSessionBySlug.ts     # Получение сессии
│   ├── listSessionsBySpace.ts  # Список сессий
│   ├── upsertParticipantOnJoin.ts  # Регистрация участника
│   ├── startServerTranscription.ts # Запуск транскрипции
│   ├── stopServerTranscription.ts  # Остановка транскрипции
│   ├── finalizeSessionTranscript.ts # Финализация транскрипта
│   ├── scheduleSessionForAnalysis.ts # Планирование AI-анализа
│   ├── autoEndInactiveSessions.ts   # Автозавершение неактивных
│   ├── expireOldCreatedSessions.ts  # Истечение протухших
│   └── saveTranscriptionUsage.ts    # Сохранение метрик
├── infra/
│   ├── prisma/
│   │   ├── sessions.repository.ts      # Репозиторий сессий
│   │   ├── transcripts.repository.ts    # Репозиторий транскриптов
│   │   └── session-analysis.repository.ts # Репозиторий анализа
│   ├── participants/
│   │   └── participants.repository.ts  # Репозиторий участников
│   ├── livekit/
│   │   ├── token.service.ts            # Генерация LiveKit токенов
│   │   └── client-config.ts            # Конфигурация LiveKit клиента
│   └── transcription/
│       ├── appendTranscriptChunk.ts    # Сохранение транскрипта
│       ├── listSessionTranscripts.ts   # Список транскриптов
│       ├── transcript.types.ts         # Типы транскриптов
│       ├── transcription-flags.ts     # Флаги транскрипции
│       ├── transcription-limits.ts    # Лимиты транскрипции
│       ├── transcription-metrics.ts  # Метрики транскрипции
│       ├── transcription-usage.repository.ts
│       └── transcription-usage.types.ts
└── api/
    ├── createSessionEndpoint.ts
    ├── endSessionEndpoint.ts
    ├── deleteSessionEndpoint.ts
    ├── listSessionsEndpoint.ts
    ├── upsertParticipantOnJoinEndpoint.ts
    ├── startTranscriptionServiceEndpoint.ts
    └── selectNewTranscriptionHostEndpoint.ts
```

#### `spaces/` — Рабочие пространства

```
spaces/
├── domain/
│   └── space.types.ts          # Типы Space, SpaceMode, SpaceRole
├── application/
│   ├── createSpace.ts          # Создание пространства
│   ├── deleteSpace.ts          # Удаление пространства
│   ├── renameSpace.ts          # Переименование
│   ├── listSpacesForUser.ts    # Список пространств
│   ├── setActiveSpaceForUser.ts # Установка активного
│   ├── updateSpaceMode.ts      # Обновление режима
│   └── ensureUserHasAtLeastOneSpace.ts
├── infra/
│   └── spaces.repository.ts    # Prisma репозиторий пространств
└── api/
    ├── createSpaceEndpoint.ts
    ├── deleteSpaceEndpoint.ts
    ├── listSpacesEndpoint.ts
    ├── renameSpaceEndpoint.ts
    ├── setActiveSpaceEndpoint.ts
    └── updateSpaceModeEndpoint.ts
```

#### `tasks/` — Задачи (skeleton)

```
tasks/
├── domain/
│   └── task.types.ts           # Типы задач (placeholder)
├── application/
│   └── getTasksPlaceholder.ts  # Placeholder use case
└── api/
    └── getTasksPlaceholderEndpoint.ts
```

---

## `/src/shared` — Общие компоненты

**Назначение:** Переиспользуемые UI компоненты (дизайн-система).

**Принцип:** Компоненты не знают про бизнес-логику, только UI.

### `/src/shared/ui` — UI компоненты

```
shared/ui/
├── avatar/                    # Avatar.tsx
├── button/                    # Кнопки
├── control-bar/               # Панель управления звонком
├── edit-profile-modal/        # Модалка редактирования профиля
├── error-boundary/            # ErrorBoundary для обработки ошибок
├── guest-join-gate/           # Gate для гостевого доступа
├── identity-modal/            # Модалка идентификации
├── input/                     # Поля ввода
├── modal/                     # Базовый модальный компонент
├── profile-menu/              # Меню профиля
├── realtime-transcript/       # RealtimeTranscript.tsx
├── session-card/              # Карточка сессии
├── space-switcher/            # Переключатель пространств
├── start-session-button/      # Кнопка запуска сессии
├── transcript-bubble/         # Пузырек транскрипта
├── tv-noise/                 # TV Noise эффект
├── video-grid/               # Сетка видео
└── video-tile/               # Плитка видео
```

---

## `/src/components` — Компоненты приложения

**Назначение:** Компоненты, специфичные для приложения (не дизайн-система).

```
components/
├── call/
│   └── TranscriptSidebar.tsx  # Боковая панель транскриптов в звонке
└── providers/
    └── Providers.tsx          # Провайдеры (React Context)
```

---

## `/src/hooks` — React хуки

**Назначение:** Переиспользуемые React хуки.

```
hooks/
├── useRealtimeTranscript.ts      # Хук для realtime транскриптов
├── useTranscriptStream.ts         # Хук для потока транскриптов
├── useLocalParticipantTranscription.ts
├── useActiveSpeakerTracker.ts     # Отслеживание активного спикера
├── useParticipants.ts            # Управление участниками
├── useRoom.ts                     # Управление LiveKit комнатой
├── useMediaControls.ts            # Управление медиа (микрофон, камера)
├── utils/
│   └── connectTranscriptionWebSocket.ts
└── __tests__/
    └── useMediaControls.test.ts
```

---

## `/src/lib` — Утилиты и библиотеки

**Назначение:** Общие утилиты, конфигурации, хелперы.

```
lib/
├── db.ts                    # Prisma client для Next.js
├── utils.ts                 # Общие утилиты
├── rate-limit.ts            # Rate limiting
├── error-handling.ts        # Обработка ошибок
├── env/                     # Конфигурация переменных окружения
│   ├── livekit.ts          # LiveKit конфигурация
│   ├── gladia.ts           # Gladia конфигурация
│   └── openai.ts           # OpenAI конфигурация
└── __tests__/
    └── rate-limit.test.ts
```

---

## `/src/contexts` — React контексты

**Назначение:** Глобальное состояние через React Context.

```
contexts/
└── TranscriptContext.tsx    # Контекст для транскриптов
```

---

## `/src/types` — TypeScript типы

**Назначение:** Глобальные TypeScript типы.

```
types/
├── next-auth.d.ts                    # Расширения NextAuth типов
├── server-transcription-message.ts   # Типы сообщений транскрипции
├── transcript-state.ts               # Состояние транскриптов
└── transcript.ts                     # Типы транскриптов
```

---

## Конфигурационные файлы

### Корень проекта

- **`package.json`** — зависимости и npm скрипты
- **`tsconfig.json`** — TypeScript конфигурация
- **`tailwind.config.ts`** — Tailwind CSS конфигурация
- **`next.config.js`** — Next.js конфигурация
- **`postcss.config.js`** — PostCSS конфигурация
- **`vercel.json`** — Vercel конфигурация (cron jobs)
- **`railway.json`** — Railway конфигурация
- **`Dockerfile`** — Docker для Next.js
- **`Dockerfile.ws`** — Docker для WS/RTMP сервера
- **`fly.toml`** — Fly.io конфигурация
- **`nixpacks.toml`** — Nixpacks конфигурация

### Sentry

- **`sentry.client.config.ts`** — Sentry для клиента
- **`sentry.server.config.ts`** — Sentry для сервера
- **`sentry.edge.config.ts`** — Sentry для Edge

---

## Legacy директории

### `/ws` и `/ws-server`

**Статус:** Deprecated (legacy)

**Назначение:** Старые версии WS сервера (до монолита).

**Примечание:** Оставлены для совместимости, но не используются в production.

---

## Архитектурные принципы

### 1. Разделение ответственности

- **`/server`** — WS/RTMP монолитный сервер (realtime транскрипция)
- **`/src/app`** — Next.js приложение (фронтенд + API)
- **`/src/modules`** — бизнес-логика (Clean Architecture)

### 2. Модульная архитектура

Каждый core-модуль (`identity`, `sessions`, `spaces`, `tasks`) имеет:
- **`domain/`** — типы и правила (без зависимостей)
- **`application/`** — use cases (бизнес-логика)
- **`infra/`** — адаптеры (Prisma, внешние сервисы)
- **`api/`** — HTTP endpoints (тонкий слой)

### 3. Дизайн-система

- **`/src/shared/ui`** — только UI компоненты
- Не знают про бизнес-логику
- Не делают fetch/API вызовы
- Получают все через props

### 4. API Routes

- Все HTTP endpoints в `src/app/api/**/route.ts`
- Тонкий слой: получают параметры, вызывают use cases, возвращают ответ
- Бизнес-логика в `modules/*/application/`

---

## Зависимости между слоями

```
┌─────────────────────────────────────────┐
│  src/app/api/**/route.ts                │  HTTP endpoints
└──────────────┬──────────────────────────┘
               │ вызывает
               ▼
┌─────────────────────────────────────────┐
│  src/modules/*/api/*Endpoint.ts         │  API layer
└──────────────┬──────────────────────────┘
               │ вызывает
               ▼
┌─────────────────────────────────────────┐
│  src/modules/*/application/*.ts        │  Use cases
└──────────────┬──────────────────────────┘
               │ использует
               ▼
┌─────────────────────────────────────────┐
│  src/modules/*/infra/**/*.ts            │  Repositories
└──────────────┬──────────────────────────┘
               │ использует
               ▼
┌─────────────────────────────────────────┐
│  Prisma / External Services             │  Infrastructure
└─────────────────────────────────────────┘
```

---

## Разделение сервисов

### Next.js (Vercel)

**Расположение:** `/src`

**Назначение:**
- Frontend (React компоненты, страницы)
- API endpoints для бизнес-логики
- Аутентификация (NextAuth)
- Работа с БД через Prisma

**Деплой:** Vercel (автоматически при push в `session-core`)

---

### WS/RTMP Сервер (Railway)

**Расположение:** `/server`

**Назначение:**
- RTMP сервер для приема потоков
- FFmpeg декодирование
- Gladia Live v2 интеграция
- WebSocket сервер для клиентов
- Метрики и мониторинг

**Деплой:** Railway (отдельный сервис)

**Порты:**
- HTTP/WebSocket: `PORT` (по умолчанию 3000)
- RTMP: `RTMP_PORT` (по умолчанию 1937)

---

## Переменные окружения

### Next.js (`.env.local`)

- `DATABASE_URL` — PostgreSQL (Neon)
- `NEXTAUTH_SECRET` — секрет для NextAuth
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit
- `GLADIA_API_KEY` — Gladia
- `OPENAI_API_KEY` — OpenAI
- `WS_SERVER_URL` — URL WS/RTMP сервера
- `CRON_SECRET` — секрет для cron jobs

### WS/RTMP Сервер (Railway env)

- `PORT` — HTTP/WebSocket порт
- `RTMP_PORT` — RTMP порт
- `DATABASE_URL` — PostgreSQL
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit
- `GLADIA_API_KEY` — Gladia
- `REALTIME_BROADCAST_MODE` — режим broadcast (`direct` или `http`)

---

## Скрипты (package.json)

### Development

- `npm run dev` — запуск Next.js dev server
- `npm run dev:ws` — запуск WS/RTMP сервера локально

### Production

- `npm run build` — сборка Next.js
- `npm run start` — запуск Next.js production
- `npm run start:ws` — запуск WS/RTMP сервера

### Database

- `npm run db:push` — push схемы в БД (dev)
- `npm run db:migrate` — применить миграции
- `npm run db:generate` — сгенерировать Prisma Client
- `npm run db:studio` — открыть Prisma Studio

### Testing

- `npm run test` — запуск тестов
- `npm run test:ui` — тесты с UI
- `npm run test:watch` — тесты в watch режиме

---

## Важные файлы

### Точки входа

- **`server/index.ts`** — точка входа WS/RTMP сервера
- **`src/app/layout.tsx`** — корневой layout Next.js
- **`src/app/page.tsx`** — главная страница

### Конфигурация

- **`prisma/schema.prisma`** — схема базы данных
- **`vercel.json`** — cron jobs для Vercel
- **`railway.json`** — конфигурация Railway
- **`next.config.js`** — конфигурация Next.js

### Миграции

- Все миграции в `prisma/migrations/`
- Формат: `YYYYMMDDHHMMSS_description/migration.sql`

---

## Резюме

### Основные директории

1. **`/server`** — WS/RTMP монолитный сервер (Railway)
2. **`/src/app`** — Next.js страницы и API (Vercel)
3. **`/src/modules/core`** — бизнес-логика (Clean Architecture)
4. **`/src/shared/ui`** — дизайн-система (UI компоненты)
5. **`/prisma`** — база данных (схема и миграции)
6. **`/docs`** — документация

### Принципы организации

- **Модульность** — каждый домен в отдельном модуле
- **Разделение слоев** — domain / application / infra / api
- **Переиспользование** — shared/ui для общих компонентов
- **Разделение сервисов** — Next.js и WS/RTMP сервер отдельно

---

**Дата создания:** 2025-12-03  
**Версия:** 1.0  
**Статус:** ✅ Актуально


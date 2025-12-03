# Rooms - Video Calls App

Приложение для видеозвонков на базе LiveKit, Next.js и PostgreSQL (Neon).

## Установка

1. Установите зависимости:

```bash
npm install
# или
pnpm install
```

2. Скопируйте `.env.example` в `.env` и заполните переменные:

```bash
cp .env.example .env
```

3. Настройте переменные окружения:
   - `DATABASE_URL` - строка подключения к PostgreSQL (Neon)
   - `LIVEKIT_API_KEY` - API ключ LiveKit
   - `LIVEKIT_API_SECRET` - API секрет LiveKit
   - `NEXT_PUBLIC_LIVEKIT_URL` - URL LiveKit сервера (wss://...)

4. Инициализируйте базу данных:

```bash
# Генерируем Prisma Client
npm run db:generate

# Применяем миграции (создаёт таблицы)
npm run db:migrate
# или для dev:
npm run db:push
```

5. Запустите dev сервер:

```bash
npm run dev
```

## Структура

- `/api/calls` - POST: создание новой комнаты
- `/api/calls/[slug]/token` - GET: получение LiveKit токена
- `/calls` - страница списка звонков
- `/call/[slug]` - страница комнаты с видеозвонком

## Миграции Prisma

После добавления модели `CallRoom` в `schema.prisma`, нужно выполнить:

```bash
npx prisma migrate dev --name add_call_room
```

Или использовать:

```bash
npm run db:migrate
```

## LiveKit

Для работы приложения нужен либо:
- LiveKit Cloud (https://cloud.livekit.io)
- Self-hosted LiveKit сервер

## TODO

- [ ] Добавить авторизацию (NextAuth) для привязки `createdByUserId`
- [ ] Улучшить обработку ошибок
- [ ] Добавить список созданных комнат пользователем
- [ ] Добавить возможность удаления комнат


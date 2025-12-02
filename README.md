# Sessions WebSocket + RTMP Server

WebSocket сервер для транскрипции с поддержкой RTMP (Room Composite Egress).

## Установка

```bash
npm install
```

## Запуск

```bash
npm start
# или для разработки
npm run dev
```

## Переменные окружения

См. `docs/RAILWAY_SETUP_GUIDE.md` в основном репозитории.

## Структура

```
ws-server/
├── server/          # Код сервера
│   ├── index.ts     # Точка входа
│   ├── rtmp-server.ts
│   ├── rtmp-ingest.ts
│   └── ...
├── package.json
└── tsconfig.json
```


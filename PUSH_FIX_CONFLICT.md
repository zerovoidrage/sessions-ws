# 🚀 Пуш исправления конфликта портов

## Команды для пуша:

```bash
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server

git add server/index.ts FIX_PORT_CONFLICT.md
git commit -m "fix: add port conflict detection and logging for RTMP/HTTP port collision"
git push origin main
```

## После пуша:

1. Убедись, что в Railway Variables **нет** `WS_PORT`/`PORT`.
2. Public Networking → Port = **Default**.
3. `RTMP_PORT=1936` (или любой другой свободный порт) и TCP proxy настроен на него.

## Что исправлено:

- Добавлена проверка конфликта портов перед запуском RTMP
- Добавлено логирование конфигурации портов
- RTMP сервер не будет пытаться запуститься, если порт занят HTTP сервером



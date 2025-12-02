# Настройка RTMP_HOST для Railway

## Варианты подключения в Railway

Railway предоставляет два типа доменов:

### 1. Public Networking (HTTP домен)
- Домен: `sessions-ws-production.up.railway.app`
- Порт: 1935 (указан в настройках)
- Протокол: HTTP/HTTPS
- **НЕ подходит для RTMP** (RTMP требует TCP)

### 2. TCP Access (TCP прокси)
- Проксированный домен: `switchyard.proxy.rlwy.net:47848`
- Внутренний порт: `1935`
- Протокол: TCP
- **✅ Подходит для RTMP**

## Правильная настройка RTMP_HOST

### Для RTMP нужно использовать TCP прокси:

```env
RTMP_HOST=switchyard.proxy.rlwy.net
RTMP_PORT=47848  # ⚠️ Внешний порт из TCP Access, НЕ 1935!
```

**ВАЖНО:**
- Используйте домен из **TCP Access** (`switchyard.proxy.rlwy.net`)
- Используйте **внешний порт** из TCP Access (`47848`), а не внутренний (`1935`)
- Не добавляйте протокол (`rtmp://`) в `RTMP_HOST`

### Полный RTMP URL будет:

```
rtmp://switchyard.proxy.rlwy.net:47848/live/SESSION_SLUG
```

## Альтернативный вариант (если TCP прокси не работает)

Если TCP прокси не работает, можно попробовать использовать HTTP домен:

```env
RTMP_HOST=sessions-ws-production.up.railway.app
RTMP_PORT=1935
```

Но это может не работать, так как RTMP требует TCP, а не HTTP.

## Проверка

После настройки проверьте логи Railway:

```
[RoomCompositeTranscriber] Egress streaming to: rtmp://switchyard.proxy.rlwy.net:47848/live/SESSION_SLUG
[RTMPIngest] ✅ Stream started: /live/SESSION_SLUG
```

Если видите ошибки подключения, проверьте:
1. `RTMP_HOST` = домен из TCP Access
2. `RTMP_PORT` = внешний порт из TCP Access (47848)
3. TCP прокси активен в Railway


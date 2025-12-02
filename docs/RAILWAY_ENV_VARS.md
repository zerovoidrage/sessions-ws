# Railway Environment Variables

## Обязательные переменные для RTMP транскрипции

### RTMP сервер (внутренний)
```env
RTMP_INTERNAL_PORT=1935
# ИЛИ просто RTMP_PORT=1935 (если не хотите добавлять новую переменную)
```

### RTMP для Egress (внешний, через TCP прокси)
```env
RTMP_EXTERNAL_PORT=47848
RTMP_HOST=switchyard.proxy.rlwy.net
```

### Полный список переменных

```env
# RTMP сервер (внутренний порт, где слушает внутри контейнера)
RTMP_INTERNAL_PORT=1935

# RTMP для Egress (внешний порт через TCP прокси Railway)
RTMP_EXTERNAL_PORT=47848

# RTMP хост (без порта!)
RTMP_HOST=switchyard.proxy.rlwy.net

# WebSocket сервер (Railway автоматически устанавливает PORT)
PORT=3001  # Опционально, Railway установит автоматически

# LiveKit
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_HTTP_URL=https://your-project.livekit.cloud

# Gladia
GLADIA_API_KEY=your_key

# Database
DATABASE_URL=postgresql://...
```

## Как это работает

1. **RTMP сервер** слушает на порту `1935` внутри контейнера
2. **Railway TCP прокси** маппит внешний порт `47848` → внутренний `1935`
3. **LiveKit Egress** подключается к `rtmp://switchyard.proxy.rlwy.net:47848/live/SESSION_SLUG`
4. **RTMP сервер** получает поток на внутреннем порту `1935`
5. **FFmpeg** декодирует RTMP → PCM16 → Gladia

## Проверка

После установки переменных проверьте логи:
- ✅ `Rtmp Server listening on port 1935` (внутренний)
- ✅ `RTMP server started for Room Composite Egress`
- ✅ При старте транскрипции: `Egress streaming to: rtmp://switchyard.proxy.rlwy.net:47848/live/...`


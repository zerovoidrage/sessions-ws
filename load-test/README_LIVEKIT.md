# LiveKit Load Test (Официальный CLI)

Используйте официальный LiveKit CLI для создания синтетических участников с реальным видео и аудио.

## Установка LiveKit CLI

### macOS
```bash
brew install livekit-cli
```

### Linux
```bash
curl -sSL https://get.livekit.io/cli | bash
```

### Windows
```bash
winget install LiveKit.LiveKitCLI
```

**Документация:** https://docs.livekit.io/home/cli/

## Использование

### Быстрый старт

```bash
# Установите переменные окружения
export NEXT_PUBLIC_LIVEKIT_URL=wss://your-server.livekit.cloud
export LIVEKIT_API_KEY=your_api_key
export LIVEKIT_API_SECRET=your_api_secret
export TEST_SESSION_SLUG=your-session-slug

# Запустите тест (5 видео участников, 10 аудио участников, 60 секунд)
./load-test/livekit-load-test.sh 5 10 60s
```

### Параметры скрипта

```bash
./load-test/livekit-load-test.sh [video_publishers] [audio_publishers] [duration]
```

- `video_publishers` - Количество участников, публикующих видео (по умолчанию: 5)
- `audio_publishers` - Количество участников, публикующих только аудио (по умолчанию: 10)
- `duration` - Длительность теста, например: `60s`, `5m`, `10m` (по умолчанию: 60s)

### Примеры

```bash
# 10 участников с видео, 20 только с аудио, тест 2 минуты
./load-test/livekit-load-test.sh 10 20 2m

# 15 участников с видео, 0 только с аудио, тест 5 минут
./load-test/livekit-load-test.sh 15 0 5m

# 0 видео, 30 аудио участников, тест 1 минута
./load-test/livekit-load-test.sh 0 30 1m
```

## Прямое использование lk CLI

Если нужно больше контроля, используйте `lk load-test` напрямую:

```bash
lk load-test \
  --url your-server.livekit.cloud \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET \
  --room your-session-slug \
  --video-publishers 10 \
  --audio-publishers 20 \
  --subscribers 50 \
  --duration 5m
```

### Дополнительные параметры

- `--subscribers <N>` - Количество подписчиков (участники без публикации, только слушают)
- `--no-simulcast` - Отключить simulcast (по умолчанию включен)
- `--video-resolution <WIDTH>x<HEIGHT>` - Разрешение видео (например: `1280x720`)
- `--video-codec <CODEC>` - Кодек видео (`vp8`, `vp9`, `h264`, `av1`)
- `--audio-bitrate <BITRATE>` - Битрейт аудио (например: `64000`)

## Как это работает

1. **Синтетические участники** - `lk load-test` создает участников, которые подключаются к LiveKit комнате
2. **Видео/Аудио** - Участники публикуют синтетические видео и аудио потоки
3. **Реальные подключения** - Это реальные WebRTC подключения к LiveKit серверу
4. **Карточки в UI** - Участники будут видны в вашем приложении как обычные участники

## Важные замечания

### Участники в БД

**⚠️ ВАЖНО:** `lk load-test` создает участников напрямую в LiveKit, но **не создает их в вашей БД** автоматически.

Участники будут видны в UI как карточки (т.к. они подключены к LiveKit), но их записей не будет в таблице `Participant`.

Если нужно создавать участников в БД:
1. Используйте webhook LiveKit для отслеживания подключений
2. Или используйте наш кастомный load test с созданием участников через API

### Ресурсы

- Каждый участник потребляет ~50-100MB RAM
- Для 30 участников: ~1.5-3GB RAM
- Рекомендуется запускать на мощной машине или в облаке

### Тестирование транскрипции

`lk load-test` создает участников с аудио, но они не подключаются к вашему WebSocket серверу транскрипции автоматически.

Для тестирования транскрипции используйте наш кастомный `ws-load-test.ts`, который:
- Создает участников в БД через API
- Подключается к WebSocket транскрипции
- Отправляет аудио чанки на транскрипцию

## Комбинированный подход

Для полного тестирования можно использовать оба инструмента одновременно:

```bash
# Терминал 1: Запускаем синтетических участников в LiveKit (видео/аудио)
./load-test/livekit-load-test.sh 10 20 5m

# Терминал 2: Запускаем тест транскрипции (WebSocket)
export TEST_SESSION_SLUG=your-session-slug
npm run load-test 15
```

Это позволит протестировать:
- ✅ Нагрузку на LiveKit (видео/аудио)
- ✅ Нагрузку на WebSocket транскрипцию
- ✅ Карточки участников в UI
- ✅ Транскрипцию в реальном времени

## Документация

- LiveKit CLI: https://docs.livekit.io/home/cli/
- Load Test: https://docs.livekit.io/home/cli/#load-testing
- GitHub: https://github.com/livekit/livekit-cli


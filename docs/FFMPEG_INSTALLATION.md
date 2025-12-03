# FFmpeg Installation for Railway

## Проблема

FFmpeg необходим для декодирования RTMP потока от LiveKit Room Composite Egress в PCM16 формат для Gladia транскрипции.

## Решение

В репозитории есть два способа установки FFmpeg:

### Вариант 1: Dockerfile (рекомендуется)

Railway автоматически обнаружит `Dockerfile` и использует его для сборки образа.

Dockerfile уже создан и устанавливает:
- Node.js 22
- FFmpeg
- Зависимости проекта

### Вариант 2: nixpacks.toml

Если Railway использует Nixpacks (автоматическое определение), он установит FFmpeg через системные пакеты.

## Проверка установки

После деплоя проверьте логи Railway - не должно быть ошибок:
```
Error: spawn ffmpeg ENOENT
```

Если ошибка есть, Railway не использует Dockerfile. В этом случае:
1. Убедитесь, что `Dockerfile` находится в корне репозитория `ws-server`
2. В Railway настройках проекта выберите "Use Dockerfile" вместо "Nixpacks"

## Локальная разработка

Для локальной разработки установите FFmpeg:

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
apt-get install ffmpeg
```

**Windows:**
Скачайте с https://ffmpeg.org/download.html





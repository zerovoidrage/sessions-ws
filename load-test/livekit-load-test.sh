#!/bin/bash
# LiveKit Load Test - Использует официальный lk CLI для создания синтетических участников
# 
# Этот скрипт использует официальный LiveKit CLI load-test для создания
# синтетических участников с видео и аудио в LiveKit комнате.
#
# Установка LiveKit CLI:
#   macOS:   brew install livekit-cli
#   Linux:   curl -sSL https://get.livekit.io/cli | bash
#   Windows: winget install LiveKit.LiveKitCLI

set -e

# Читаем переменные окружения
LIVEKIT_URL="${NEXT_PUBLIC_LIVEKIT_URL}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET}"

# Параметры по умолчанию
SESSION_SLUG="${TEST_SESSION_SLUG:-load-test-session}"
VIDEO_PUBLISHERS="${1:-5}"  # Количество участников с видео (аргумент 1 или по умолчанию 5)
AUDIO_PUBLISHERS="${2:-10}" # Количество участников только с аудио (аргумент 2 или по умолчанию 10)
DURATION="${3:-60s}"        # Длительность теста (аргумент 3 или по умолчанию 60 секунд)

# Проверяем наличие LiveKit CLI
if ! command -v lk &> /dev/null; then
    echo "❌ LiveKit CLI не установлен!"
    echo ""
    echo "Установите LiveKit CLI:"
    echo "  macOS:   brew install livekit-cli"
    echo "  Linux:   curl -sSL https://get.livekit.io/cli | bash"
    echo "  Windows: winget install LiveKit.LiveKitCLI"
    echo ""
    echo "Документация: https://docs.livekit.io/home/cli/"
    exit 1
fi

# Проверяем переменные окружения
if [ -z "$LIVEKIT_URL" ] || [ -z "$LIVEKIT_API_KEY" ] || [ -z "$LIVEKIT_API_SECRET" ]; then
    echo "❌ Не установлены переменные окружения LiveKit!"
    echo ""
    echo "Убедитесь, что установлены:"
    echo "  NEXT_PUBLIC_LIVEKIT_URL"
    echo "  LIVEKIT_API_KEY"
    echo "  LIVEKIT_API_SECRET"
    echo ""
    echo "Или экспортируйте их перед запуском:"
    echo "  export NEXT_PUBLIC_LIVEKIT_URL=wss://your-server.livekit.cloud"
    echo "  export LIVEKIT_API_KEY=your_api_key"
    echo "  export LIVEKIT_API_SECRET=your_api_secret"
    exit 1
fi

# Убираем протокол из URL (lk CLI принимает URL без wss://)
LIVEKIT_HOST=$(echo "$LIVEKIT_URL" | sed 's|^wss\?://||')

echo "🚀 Запуск LiveKit Load Test"
echo "================================"
echo "Комната: $SESSION_SLUG"
echo "Участники с видео: $VIDEO_PUBLISHERS"
echo "Участники с аудио: $AUDIO_PUBLISHERS"
echo "Длительность: $DURATION"
echo "LiveKit сервер: $LIVEKIT_HOST"
echo "================================"
echo ""

# Запускаем нагрузочный тест
# Simulcast включен по умолчанию (для отключения используй --no-simulcast)
lk load-test \
  --url "$LIVEKIT_HOST" \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --room "$SESSION_SLUG" \
  --video-publishers "$VIDEO_PUBLISHERS" \
  --audio-publishers "$AUDIO_PUBLISHERS" \
  --duration "$DURATION"

echo ""
echo "✅ Load test завершен"


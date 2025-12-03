#!/bin/bash
# Быстрая установка всех переменных окружения для Fly.io
# Использование: ./fly-setup-env.sh

set -e

# Проверка авторизации
if ! fly auth whoami &>/dev/null; then
    echo "❌ Ты не авторизован. Выполни: fly auth login"
    exit 1
fi

# Определяем имя приложения из fly.toml
if [ ! -f "fly.toml" ]; then
    echo "❌ fly.toml не найден. Сначала выполни: fly launch"
    exit 1
fi

APP_NAME=$(grep "^app = " fly.toml | sed 's/app = "\(.*\)"/\1/' | tr -d ' ')
if [ -z "$APP_NAME" ]; then
    echo "❌ Не могу определить имя приложения"
    exit 1
fi

echo "🚀 Установка переменных для приложения: $APP_NAME"

# Все переменные из документации
fly secrets set DATABASE_URL="postgresql://neondb_owner:npg_9GujiJSIWr4T@ep-mute-cloud-agqqloae-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require" --app "$APP_NAME"
fly secrets set LIVEKIT_HTTP_URL="https://omni-pxx5e1ko.livekit.cloud" --app "$APP_NAME"
fly secrets set LIVEKIT_API_KEY="APILED8W5B2vGjd" --app "$APP_NAME"
fly secrets set LIVEKIT_API_SECRET="JKKrI04fCYpxGuyBASiglMSnupSe7a9hVowBlpE2Qp5" --app "$APP_NAME"
fly secrets set GLADIA_API_KEY="aeb596f4-b70e-4d92-a3de-8084b24ebf90" --app "$APP_NAME"
fly secrets set TRANSCRIPTION_JWT_SECRET="99b38577b08830fce2493607c263559b36696308fca91e01d3c3058cc3634d30" --app "$APP_NAME"
fly secrets set RTMP_PORT="1937" --app "$APP_NAME"
fly secrets set RTMP_INTERNAL_PORT="1937" --app "$APP_NAME"
fly secrets set NODE_ENV="production" --app "$APP_NAME"

echo "✅ Все переменные установлены!"
echo ""
echo "Следующий шаг: fly deploy"


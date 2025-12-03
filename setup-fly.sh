#!/bin/bash
# Скрипт для настройки Fly.io приложения
# Запускай после fly auth login и fly launch

set -e

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Настройка Fly.io приложения...${NC}"

# Проверка авторизации
if ! fly auth whoami &>/dev/null; then
    echo -e "${YELLOW}⚠️  Ты не авторизован. Выполни:${NC}"
    echo "   fly auth login"
    exit 1
fi

# Проверка приложения
if [ ! -f "fly.toml" ]; then
    echo -e "${YELLOW}⚠️  fly.toml не найден. Сначала выполни:${NC}"
    echo "   fly launch"
    exit 1
fi

APP_NAME=$(grep "^app = " fly.toml | sed 's/app = "\(.*\)"/\1/' | tr -d ' ')
if [ -z "$APP_NAME" ]; then
    echo -e "${YELLOW}⚠️  Не могу определить имя приложения из fly.toml${NC}"
    exit 1
fi

echo -e "${GREEN}📦 Приложение: ${APP_NAME}${NC}"

# Установка переменных окружения
echo -e "${GREEN}🔐 Установка переменных окружения...${NC}"

# Читаем переменные из файла .env или используем дефолтные
if [ -f "../.env.local" ]; then
    echo "📄 Используем переменные из .env.local"
    source ../.env.local
elif [ -f ".env" ]; then
    echo "📄 Используем переменные из .env"
    source .env
fi

# DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    DATABASE_URL="postgresql://neondb_owner:npg_9GujiJSIWr4T@ep-mute-cloud-agqqloae-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require"
fi
fly secrets set DATABASE_URL="$DATABASE_URL" --app "$APP_NAME"

# LiveKit
fly secrets set LIVEKIT_HTTP_URL="${LIVEKIT_HTTP_URL:-https://omni-pxx5e1ko.livekit.cloud}" --app "$APP_NAME"
fly secrets set LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-APILED8W5B2vGjd}" --app "$APP_NAME"
fly secrets set LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-JKKrI04fCYpxGuyBASiglMSnupSe7a9hVowBlpE2Qp5}" --app "$APP_NAME"

# Gladia
fly secrets set GLADIA_API_KEY="${GLADIA_API_KEY:-aeb596f4-b70e-4d92-a3de-8084b24ebf90}" --app "$APP_NAME"

# JWT
fly secrets set TRANSCRIPTION_JWT_SECRET="${TRANSCRIPTION_JWT_SECRET:-99b38577b08830fce2493607c263559b36696308fca91e01d3c3058cc3634d30}" --app "$APP_NAME"

# RTMP
fly secrets set RTMP_PORT="${RTMP_PORT:-1937}" --app "$APP_NAME"
fly secrets set RTMP_INTERNAL_PORT="${RTMP_INTERNAL_PORT:-1937}" --app "$APP_NAME"

# Node.js
fly secrets set NODE_ENV="production" --app "$APP_NAME"

echo -e "${GREEN}✅ Все переменные установлены!${NC}"
echo ""
echo -e "${GREEN}📋 Следующие шаги:${NC}"
echo "   1. fly deploy"
echo "   2. fly logs"
echo "   3. Обнови NEXT_PUBLIC_WS_HOST во фронтенде на: ${APP_NAME}.fly.dev"


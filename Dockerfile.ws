# Dockerfile для WebSocket сервера транскрипции
# Используем Debian-based образ для лучшей совместимости с Prisma
FROM node:20-slim

WORKDIR /app

# Устанавливаем необходимые зависимости для Prisma
RUN apt-get update && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Копируем package.json для установки зависимостей
COPY ws/package.json ./

# Устанавливаем зависимости (включая devDependencies для tsx)
RUN npm install

# Копируем Prisma schema и генерируем клиент
COPY ws/prisma/ ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma

# Копируем исходный код WebSocket сервера
COPY ws/server/ ./server/
COPY ws/tsconfig.json ./

# Используем PORT от Railway или WS_PORT
ENV PORT=${PORT:-3001}

# Открываем порт для WebSocket
EXPOSE ${PORT}

# Запускаем сервер через tsx
CMD ["npm", "run", "start"]







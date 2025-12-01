# Dockerfile для WebSocket сервера транскрипции
# Используем Debian-based образ для лучшей совместимости с Prisma
FROM node:20-slim

WORKDIR /app

# Устанавливаем необходимые зависимости для Prisma
RUN apt-get update && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Копируем package.json для установки зависимостей
COPY package.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем Prisma schema и генерируем клиент
COPY prisma/ ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma

# Копируем исходный код WebSocket сервера
# После subtree push структура будет: server/, tsconfig.json в корне
COPY server/ ./server/
COPY tsconfig.json ./

# Используем PORT от Render или WS_PORT
ENV PORT=10000

# Открываем порт для WebSocket (Render использует PORT)
EXPOSE 10000

# Запускаем сервер через tsx
CMD ["npm", "run", "start"]


# Dockerfile для WebSocket сервера транскрипции
FROM node:20-alpine

WORKDIR /app

# Устанавливаем OpenSSL для Prisma (Alpine 3.22 использует OpenSSL 3.x)
# Prisma может работать с OpenSSL 3.x, но если нужна совместимость с 1.1, используем openssl
RUN apk add --no-cache openssl libc6-compat

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


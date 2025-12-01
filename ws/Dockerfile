# Dockerfile для WebSocket сервера транскрипции
FROM node:20-alpine

WORKDIR /app

# Копируем package.json для установки зависимостей
COPY package.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код WebSocket сервера
# После subtree push структура будет: server/, tsconfig.json в корне
COPY server/ ./server/
COPY tsconfig.json ./

# Открываем порт для WebSocket
EXPOSE 3001

# Запускаем сервер через tsx
CMD ["npm", "run", "start"]


# Dockerfile для WebSocket сервера
FROM node:20-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем файл WebSocket сервера
COPY server-websocket.js ./

# Открываем порт для WebSocket
EXPOSE 3001

# Запускаем сервер
CMD ["node", "server-websocket.js"]






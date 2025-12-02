# Используем официальный Node.js образ
FROM node:22-slim

# Устанавливаем FFmpeg и необходимые зависимости
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем остальные файлы
COPY . .

# Генерируем Prisma Client
RUN npx prisma generate

# Открываем порты
EXPOSE 8000 1935

# Запускаем сервер
CMD ["npm", "start"]


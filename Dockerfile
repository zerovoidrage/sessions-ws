# Используем официальный Node.js образ
FROM node:22-slim

# Устанавливаем FFmpeg, инструменты сборки и зависимости для opus
RUN apt-get update && \
    apt-get install -y \
        ffmpeg \
        build-essential \
        python3 \
        pkg-config \
        libopus-dev \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и prisma схему (нужна для generate)
COPY package.json ./
COPY prisma ./prisma

# Устанавливаем зависимости (используем npm install, так как нет package-lock.json)
RUN npm install --omit=dev

# Генерируем Prisma Client (prisma теперь в dependencies)
RUN npx prisma generate

# Копируем остальные файлы
COPY . .

# Открываем порты
EXPOSE 8000 1935

# Запускаем сервер
CMD ["npm", "start"]


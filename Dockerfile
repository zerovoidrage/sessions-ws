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

# Устанавливаем зависимости (включая devDependencies для tsx)
RUN npm install

# Генерируем Prisma Client (prisma теперь в dependencies)
RUN npx prisma generate

# Копируем остальные файлы
COPY . .

# Открываем порты (PORT для Next.js, WS_PORT для WS/RTMP сервера, RTMP на 1937)
# В моносервисе Next.js работает на PORT (3000), WS/RTMP сервер на WS_PORT (3001)
EXPOSE ${PORT:-3000} ${WS_PORT:-3001} 1937

# Запускаем моносервис (Next.js + WS/RTMP сервер через concurrently)
CMD ["npm", "run", "start:monolith"]


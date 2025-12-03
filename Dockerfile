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

# Открываем порты (PORT для HTTP/WebSocket, RTMP на 1937)
# Это только WS/RTMP моносервис, Next.js работает отдельно
EXPOSE ${PORT:-3000} 1937

# Запускаем WS/RTMP моносервис (без Next.js)
CMD ["npm", "run", "start:ws"]


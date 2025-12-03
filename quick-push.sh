#!/bin/bash

# Быстрый пуш обновлений в GitHub

cd "$(dirname "$0")"

echo "🚀 Пушим обновления в GitHub..."

git add server/index.ts
git commit -m "fix: ignore PORT=1935 from Railway auto-detection, use WS_PORT or fallback to 3001"
git push origin main

echo "✅ Готово! Railway начнёт новый деплой."
echo ""
echo "📝 Добавь в Railway Variables:"
echo "   WS_PORT=8000"
echo ""
echo "Это гарантирует, что HTTP/WebSocket будет слушать на 8000, даже если Railway установит PORT=1935"


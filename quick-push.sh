#!/bin/bash

# Быстрый пуш обновлений в GitHub

cd "$(dirname "$0")"

echo "🚀 Пушим обновления в GitHub..."

git add server/index.ts
git commit -m "fix: rely on Railway PORT and remove WS_PORT fallback"
git push origin main

echo "✅ Готово! Railway начнёт новый деплой."
echo ""
echo "📝 Проверь Railway:"
echo "   - нет переменных PORT / WS_PORT"
echo "   - Public Networking → Port = Default / Auto-detect"
echo "   - TCP proxy для RTMP остаётся на 1936"
echo ""

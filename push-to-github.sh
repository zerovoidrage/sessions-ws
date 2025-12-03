#!/bin/bash

# Пуш WS сервера в GitHub
cd "$(dirname "$0")"

echo "🚀 Пушим WS сервер в GitHub..."

# Проверяем remote
git remote -v

# Проверяем статус
echo ""
echo "📊 Статус:"
git status --short

# Добавляем все изменения
echo ""
echo "➕ Добавляем изменения..."
git add .

# Коммитим
echo ""
echo "💾 Коммитим..."
git commit -m "chore: update ws server" || echo "Нет изменений для коммита"

# Пушим
echo ""
echo "📤 Пушим в GitHub..."
git push ws main || git push origin main || {
    echo "❌ Ошибка при push"
    echo "💡 Проверьте remote:"
    git remote -v
    exit 1
}

echo ""
echo "✅ Готово! WS сервер запушен в GitHub"




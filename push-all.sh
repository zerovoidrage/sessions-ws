#!/bin/bash

# Скрипт для пуша всех изменений
# Основной репозиторий → GitLab
# WS сервер → GitHub

set -e

echo "🚀 Начинаем пуш изменений..."

# 1. Пуш основного репозитория (GitLab)
echo ""
echo "📦 Пуш основного репозитория в GitLab..."
cd /Users/bogdvncollins/Documents/work/dev/rooms

git add .cursorrules REMOVE_SERVER_FOLDER.md
git commit -m "chore: update project structure - use ws-server only, remove server folder reference" || echo "Нет изменений для коммита"

git push origin main || {
    echo "⚠️  Ошибка при push в GitLab. Проверьте remote:"
    git remote -v
    exit 1
}

echo "✅ Основной репозиторий запушен в GitLab"

# 2. Пуш WS сервера (GitHub)
echo ""
echo "📦 Пуш WS сервера в GitHub..."
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server

if [ -d .git ]; then
    git status --short
    
    read -p "Закоммитить изменения в ws-server? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add .
        git commit -m "chore: update ws server" || echo "Нет изменений для коммита"
        git push ws main || {
            echo "⚠️  Ошибка при push в GitHub. Проверьте remote:"
            git remote -v
            exit 1
        }
        echo "✅ WS сервер запушен в GitHub"
    else
        echo "⏭️  Пропущен пуш WS сервера"
    fi
else
    echo "⚠️  ws-server не является git репозиторием. Пропускаем."
fi

echo ""
echo "✅ Готово!"




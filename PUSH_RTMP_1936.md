# 🚀 Пуш изменений RTMP порта на 1936

## Команды для пуша:

```bash
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server

git add .
git commit -m "feat: change RTMP port from 1935 to 1936 to avoid Railway auto-detection conflict"
git push origin main
```

## После пуша - обновить Railway:

### 1. Variables:
Изменить `RTMP_PORT=1935` → `RTMP_PORT=1936`

### 2. Networking → TCP Proxy:
- Удалить старый TCP proxy (порт 1935)
- Создать новый TCP proxy для порта **1936**
- Обновить `RTMP_EXTERNAL_PORT` на новый внешний порт

### 3. Результат:
- ✅ HTTP/WebSocket на порту 8000 (без конфликта)
- ✅ RTMP на порту 1936 (новый порт)
- ✅ Railway не будет конфликтовать с портом 1935


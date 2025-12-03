# 🚀 Пуш исправления - выполни эти команды:

```bash
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server

git add server/index.ts
git commit -m "fix: ignore PORT=1935 from Railway auto-detection, use WS_PORT or fallback to 3001"
git push origin main
```

## После пуша:

Добавь в Railway Variables:
```
WS_PORT=8000
```

Это гарантирует, что HTTP/WebSocket будет слушать на 8000, даже если Railway установит PORT=1935.


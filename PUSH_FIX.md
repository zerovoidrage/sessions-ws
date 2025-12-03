# 🚀 Пуш исправления - выполни эти команды:

```bash
cd /Users/bogdvncollins/Documents/work/dev/rooms/ws-server

git add server/index.ts
git commit -m "fix: rely on Railway PORT and remove WS_PORT fallback"
git push origin main
```

## После пуша
1. Убедись, что в Railway Variables **нет** `WS_PORT`/`PORT`.
2. В Settings → Public Networking установи Port = **Default / Auto-detect**.
3. TCP Proxy для RTMP оставляем на 1936.

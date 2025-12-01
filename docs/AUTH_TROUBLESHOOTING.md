# Troubleshooting Authentication Issues

## Проблема: После входа через Google возвращает на страницу авторизации

### Возможные причины:

1. **NEXTAUTH_SECRET не установлен или неправильный**
   - Проверьте в Vercel Dashboard → Settings → Environment Variables
   - Должен быть установлен `NEXTAUTH_SECRET`
   - Можно сгенерировать: `openssl rand -base64 32`

2. **NEXTAUTH_URL неправильно настроен**
   - Должен быть установлен в Vercel как `NEXTAUTH_URL`
   - Значение: `https://www.4sessions.space` (без слеша в конце)
   - Без этого NextAuth не сможет правильно обработать callback

3. **Google OAuth Redirect URI неправильный**
   - В Google Cloud Console должно быть:
   - `https://www.4sessions.space/api/auth/callback/google`
   - НЕ `/auth/callback/google` (без `/api/`)

4. **Cookies блокируются браузером**
   - Проверьте в DevTools → Application → Cookies
   - Должна быть cookie `next-auth.session-token`
   - Если нет - проблема с настройками cookies

### Как проверить:

1. **Проверьте переменные окружения в Vercel:**
   ```
   NEXTAUTH_SECRET=... (должен быть установлен)
   NEXTAUTH_URL=https://www.4sessions.space
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

2. **Проверьте Google Cloud Console:**
   - Authorized JavaScript origins: `https://www.4sessions.space`
   - Authorized redirect URIs: `https://www.4sessions.space/api/auth/callback/google`

3. **Проверьте логи в Vercel:**
   - После успешного callback должно быть создание JWT токена
   - Проверьте, нет ли ошибок в логах

4. **Проверьте cookies в браузере:**
   - DevTools → Application → Cookies → `https://www.4sessions.space`
   - Должна быть cookie `next-auth.session-token`

### Решение:

1. Убедитесь, что все переменные окружения установлены в Vercel
2. Проверьте, что `NEXTAUTH_URL` точно `https://www.4sessions.space` (без слеша)
3. Убедитесь, что в Google Cloud Console правильно указан redirect URI с `/api/auth/callback/google`
4. После изменений пересоберите проект на Vercel


# Инструкция по настройке Fly.io

## Шаг 1: Авторизация (интерактивно)

Выполни вручную (откроется браузер):

```bash
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
fly auth login
```

## Шаг 2: Создание приложения (интерактивно)

```bash
cd ws-server
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
fly launch
```

**При вопросах:**
- "Do you want to copy your configuration file now?" → **No**
- Выбери регион (например, `iad`)
- Имя приложения (например, `sessions-ws-server`)

## Шаг 3: Установка переменных окружения (автоматически)

После `fly launch` выполни:

```bash
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
./fly-setup-env.sh
```

Или вручную установи все переменные:

```bash
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# Определи имя приложения из fly.toml
APP_NAME=$(grep "^app = " fly.toml | sed 's/app = "\(.*\)"/\1/' | tr -d ' ')

fly secrets set DATABASE_URL="postgresql://neondb_owner:npg_9GujiJSIWr4T@ep-mute-cloud-agqqloae-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require" --app "$APP_NAME"
fly secrets set LIVEKIT_HTTP_URL="https://omni-pxx5e1ko.livekit.cloud" --app "$APP_NAME"
fly secrets set LIVEKIT_API_KEY="APILED8W5B2vGjd" --app "$APP_NAME"
fly secrets set LIVEKIT_API_SECRET="JKKrI04fCYpxGuyBASiglMSnupSe7a9hVowBlpE2Qp5" --app "$APP_NAME"
fly secrets set GLADIA_API_KEY="aeb596f4-b70e-4d92-a3de-8084b24ebf90" --app "$APP_NAME"
fly secrets set TRANSCRIPTION_JWT_SECRET="99b38577b08830fce2493607c263559b36696308fca91e01d3c3058cc3634d30" --app "$APP_NAME"
fly secrets set RTMP_PORT="1937" --app "$APP_NAME"
fly secrets set RTMP_INTERNAL_PORT="1937" --app "$APP_NAME"
fly secrets set NODE_ENV="production" --app "$APP_NAME"
```

## Шаг 4: Деплой

```bash
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
fly deploy
```

## Шаг 5: Проверка

```bash
# Логи
fly logs

# Статус
fly status
```

## Шаг 6: Обновление фронтенда

После успешного деплоя обнови переменные окружения фронтенда:

```env
NEXT_PUBLIC_WS_HOST=sessions-ws-server.fly.dev  # Замени на имя твоего приложения
```

## Добавление Fly CLI в PATH навсегда

Чтобы не экспортировать PATH каждый раз, добавь в `~/.zshrc`:

```bash
export FLYCTL_INSTALL="/Users/bogdvncollins/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
```

Затем:
```bash
source ~/.zshrc
```


# Архитектура сессий (Video Sessions)

Детальное описание того, как устроены сессии, процесс подключения участников и работа с несколькими участниками одновременно.

---

## 1. Общая архитектура

### 1.1. Компоненты системы

Система сессий состоит из следующих компонентов:

1. **Next.js API Routes** — HTTP эндпоинты для управления сессиями
2. **LiveKit** — сервис для видеосвязи (WebRTC)
3. **Gladia** — сервис для транскрипции аудио в текст
4. **WebSocket сервер** — отдельный Node.js сервер для обработки транскрипции
5. **PostgreSQL (Prisma)** — база данных для хранения сессий, участников и транскриптов

### 1.2. Модели данных

#### VideoSession
```prisma
model VideoSession {
  id              String          @id @default(cuid())
  slug            String          @unique  // Уникальный идентификатор для URL
  title           String?
  createdByUserId String?
  status          SessionStatus   @default(ACTIVE)  // ACTIVE | ENDED
  createdAt       DateTime        @default(now())
  endedAt         DateTime?
  spaceId         String          // Привязка к рабочему пространству
  
  participants    Participant[]   // Участники сессии
  transcripts     TranscriptSegment[]  // Сегменты транскрипции
}
```

#### Participant
```prisma
model Participant {
  id            String            @id @default(cuid())
  videoSessionId String           // Связь с сессией
  userId        String?            // Опциональная связь с User (если авторизован)
  identity      String            // LiveKit identity (уникальный в рамках сессии)
  name          String?           // Отображаемое имя
  role          ParticipantRole   @default(GUEST)  // HOST | GUEST
  joinedAt      DateTime          @default(now())
  leftAt        DateTime?         // Когда покинул сессию
  
  @@unique([videoSessionId, identity])  // Один identity = один участник в сессии
}
```

#### TranscriptSegment
```prisma
model TranscriptSegment {
  id            String       @id @default(cuid())
  videoSessionId String      // Связь с сессией
  participantId String?      // Опциональная связь с участником
  utteranceId   String       // ID сегмента от Gladia (для группировки)
  text          String       // Текст транскрипции
  isFinal       Boolean      @default(false)  // Финальный или промежуточный
  startedAt     DateTime     // Время начала utterance
  endedAt       DateTime?
  createdAt     DateTime     @default(now())
  
  @@unique([videoSessionId, utteranceId])  // Один utteranceId = один сегмент
}
```

---

## 2. Жизненный цикл сессии

### 2.1. Создание сессии

**Путь:** `POST /api/sessions`

**Процесс:**

1. **Пользователь нажимает "Create Session"** на странице `/sessions`
   - Компонент: `SessionsPageClient.tsx`
   - Выполняется `POST /api/sessions` с `{ title?, spaceId? }`

2. **API endpoint** (`src/app/api/sessions/route.ts`):
   ```typescript
   - Получает текущего пользователя через getCurrentUser()
   - Вызывает createSessionEndpoint(user, { title, spaceId })
   ```

3. **Application layer** (`src/modules/core/sessions/application/createSession.ts`):
   ```typescript
   - Генерирует уникальный slug (nanoid(8))
   - Создает запись VideoSession в БД через Prisma
   - Статус: ACTIVE
   - Возвращает созданную сессию
   ```

4. **Результат:**
   - Создается запись в таблице `VideoSession`
   - Генерируется уникальный `slug` (например: `XkAGvchH`)
   - Пользователь перенаправляется на `/session/[slug]`

**Важно:** На этом этапе участники еще не создаются. Они создаются только при подключении к LiveKit комнате.

---

### 2.2. Подключение к сессии (один участник)

**Путь:** `/session/[slug]`

**Процесс:**

#### Шаг 1: Загрузка страницы

1. **Компонент** `src/app/session/[slug]/page.tsx`:
   - Получает `slug` из URL
   - Проверяет авторизацию через `useSession()` (NextAuth)
   - Получает `displayName` из сессии пользователя

2. **Проверка displayName:**
   ```typescript
   if (!userDisplayName) {
     setError('Display name is required. Please complete onboarding first.')
     return
   }
   ```
   - Если `displayName` отсутствует, показывается ошибка с предложением пройти онбординг

#### Шаг 2: Получение токена LiveKit

3. **Запрос токена:** `GET /api/sessions/[slug]/token?name=DisplayName`

   **API endpoint** (`src/app/api/sessions/[slug]/token/route.ts`):
   ```typescript
   - Получает сессию по slug через getSessionBySlug({ slug })
   - Проверяет существование сессии (404 если не найдена)
   - Получает displayName из сессии пользователя (приоритет) или из параметра name
   - Генерирует случайный identity: `guest-${slug}-${random}`
   - Вызывает generateToken() для создания LiveKit токена
   ```

4. **Генерация токена** (`src/modules/core/sessions/infra/livekit/token.service.ts`):
   ```typescript
   - Создает AccessToken с identity и name
   - Добавляет grant: room = sessionSlug, roomJoin = true, canPublish = true, canSubscribe = true
   - Возвращает JWT токен, roomName (slug), identity, serverUrl
   ```

#### Шаг 3: Подключение к LiveKit комнате

5. **Компонент SessionContent:**
   - Использует хук `useRoom(token, serverUrl)`
   - Создает экземпляр `Room` из `livekit-client`
   - Вызывает `room.connect(serverUrl, token)`

6. **LiveKit обрабатывает подключение:**
   - Проверяет токен (валидность, права доступа)
   - Создает или находит комнату с именем = `slug`
   - Регистрирует участника с `identity` и `name`
   - Устанавливает WebRTC соединение

7. **После подключения:**
   - `room.state` становится `'connected'`
   - Срабатывает событие `RoomEvent.Connected`
   - `localParticipant` становится доступным

#### Шаг 4: Инициализация медиа

8. **Автоматическое включение микрофона:**
   ```typescript
   useEffect(() => {
     if (room.state === 'connected' && localParticipant) {
       await localParticipant.setMicrophoneEnabled(true)
     }
   }, [room, localParticipant])
   ```
   - Микрофон включается автоматически
   - Камера остается выключенной по умолчанию

#### Шаг 5: Запуск транскрипции

9. **Транскрипция локального участника:**
   - Хук `useLocalParticipantTranscription` создает WebSocket соединение с транскрипционным сервером
   - WebSocket URL: `ws://localhost:8080?sessionSlug=${slug}&identity=${identity}`
   - Захватывает аудио из микрофона через `AudioContext`
   - Отправляет аудио чанки на WebSocket сервер

10. **WebSocket сервер** (`ws/server/client-connection.ts`):
    - Принимает аудио чанки от клиента
    - Передает их в Gladia через `gladia-bridge`
    - Получает транскрипты от Gladia
    - Сохраняет транскрипты в БД через `appendTranscriptChunk()`
    - Отправляет транскрипты обратно клиенту через WebSocket

11. **Обработка транскриптов на клиенте:**
    - WebSocket сервер отправляет транскрипты клиенту
    - Клиент получает транскрипты через `useLocalParticipantTranscription`
    - Транскрипты публикуются в LiveKit комнату через `localParticipant.publishData()`
    - Другие участники получают транскрипты через `room.on('dataReceived')`

---

### 2.3. Подключение второго участника

Когда второй человек открывает `/session/[slug]`:

#### Шаг 1: Получение токена

1. **Тот же процесс, что и для первого участника:**
   - Получение `displayName` из сессии пользователя
   - Запрос `GET /api/sessions/[slug]/token?name=DisplayName`
   - Генерация **нового** `identity`: `guest-${slug}-${random}` (уникальный для каждого участника)

#### Шаг 2: Подключение к той же LiveKit комнате

2. **LiveKit обрабатывает подключение:**
   - Находит существующую комнату по `slug`
   - Регистрирует нового участника с новым `identity`
   - Уведомляет всех существующих участников о новом подключении

3. **События в комнате:**
   - У первого участника срабатывает `RoomEvent.ParticipantConnected`
   - Хук `useParticipants` обновляет список участников
   - `VideoGrid` автоматически обновляется и показывает обоих участников

#### Шаг 3: Синхронизация участников

4. **LiveKit автоматически синхронизирует:**
   - **Видео треки:** каждый участник публикует свой видео-трек, другие подписываются
   - **Аудио треки:** каждый участник публикует свой аудио-трек, другие подписываются
   - **Метаданные:** `identity`, `name` доступны всем участникам

5. **UI обновляется:**
   - `VideoGrid` получает обновленный список участников
   - Отображается сетка с видео всех участников
   - Каждый участник видит себя и других

#### Шаг 4: Транскрипция для второго участника

6. **Второй участник запускает свою транскрипцию:**
   - Создает свое WebSocket соединение с `identity` второго участника
   - Захватывает свой аудио поток
   - Отправляет на транскрипционный сервер

7. **Транскрипционный сервер:**
   - Создает отдельный Gladia bridge для второго участника
   - Обрабатывает аудио от обоих участников параллельно
   - Сохраняет транскрипты в БД с `participantIdentity` каждого участника

8. **Синхронизация транскриптов:**
   - Каждый участник публикует свои транскрипты через `publishData()`
   - Все участники получают транскрипты через `room.on('dataReceived')`
   - Хук `useTranscriptStream` обрабатывает входящие транскрипты
   - `TranscriptSidebar` отображает транскрипты всех участников с их аватарами

---

## 3. Работа с несколькими участниками

### 3.1. Синхронизация участников

**LiveKit автоматически управляет:**

1. **Подключение/отключение:**
   - При подключении нового участника все остальные получают событие `ParticipantConnected`
   - При отключении участника все получают событие `ParticipantDisconnected`
   - Хук `useParticipants` автоматически обновляет список

2. **Видео треки:**
   - Каждый участник публикует свой видео-трек
   - Другие участники автоматически подписываются на новые треки
   - `VideoGrid` обновляется при изменении треков

3. **Аудио треки:**
   - Каждый участник публикует свой аудио-трек
   - Другие участники слышат голос каждого участника
   - `VideoTile` показывает индикатор "speaking" при активном аудио

### 3.2. Транскрипция для нескольких участников

**Архитектура:**

1. **Каждый участник имеет свой WebSocket:**
   - URL: `ws://localhost:8080?sessionSlug=${slug}&identity=${identity}`
   - Каждое соединение обрабатывается отдельно
   - Каждое соединение имеет свой Gladia bridge

2. **Gladia обрабатывает аудио параллельно:**
   - Каждый участник отправляет свой аудио поток
   - Gladia транскрибирует каждый поток независимо
   - Каждый транскрипт помечается `speakerId` = `identity` участника

3. **Сохранение в БД:**
   ```typescript
   await appendTranscriptChunk({
     sessionSlug,
     participantIdentity: identity,  // Уникальный для каждого участника
     utteranceId,
     text,
     isFinal,
     startedAt,
     endedAt,
   })
   ```
   - Функция `upsertParticipantByIdentity()` создает или обновляет запись `Participant`
   - Связывает транскрипт с участником через `participantId`

4. **Распространение транскриптов:**
   - Каждый участник публикует свои транскрипты через `publishData()`
   - Все участники получают транскрипты через `dataReceived`
   - `useTranscriptStream` фильтрует транскрипты от локального участника (избегает дублирования)

### 3.3. Отображение участников

**VideoGrid компонент:**

1. **Список участников:**
   ```typescript
   const allParticipants = localParticipant 
     ? [localParticipant, ...participants.filter(p => p.identity !== localParticipant.identity)]
     : participants
   ```
   - Включает локального участника и всех удаленных
   - Убирает дубликаты по `identity`

2. **Layout:**
   - **1 участник:** большой вид в центре
   - **2-4 участника:** сетка 2x2
   - **5+ участников:** сетка 3x3

3. **Видео треки:**
   - Для каждого участника ищется активный видео-трек (Camera, не muted)
   - Если видео нет, показывается пустой блок
   - Локальный участник видит свое видео, другие видят видео удаленных участников

4. **Аудио треки:**
   - Автоматически воспроизводится через WebRTC
   - Индикатор "speaking" показывается при активном аудио

### 3.4. Отображение транскриптов

**TranscriptSidebar компонент:**

1. **Получение данных участников:**
   - Для каждого уникального `speakerId` загружаются данные через `/api/sessions/[slug]/participants/[identity]`
   - Получаются `avatarUrl`, `noAvatarColor`, `displayName` из профиля пользователя
   - Данные кэшируются в `Map<speakerId, ParticipantData>`

2. **Отображение сообщений:**
   - Каждое сообщение показывает аватар участника через компонент `Avatar`
   - Используется реальный аватар из профиля или цветной аватар с инициалами
   - Показывается `displayName` участника

3. **Группировка:**
   - Сообщения группируются по `utteranceId` (ID от Gladia)
   - Промежуточные транскрипты (`isFinal: false`) обновляют существующее сообщение
   - Финальные транскрипты (`isFinal: true`) фиксируются

---

## 4. Детальный процесс подключения нескольких участников

### Сценарий: 3 участника подключаются к одной сессии

#### Участник 1 (создатель сессии)

1. **Создание сессии:**
   - Создается `VideoSession` с `slug = "abc123"`
   - Статус: `ACTIVE`

2. **Подключение:**
   - Получает токен с `identity = "guest-abc123-xyz789"`
   - Подключается к LiveKit комнате `"abc123"`
   - LiveKit создает комнату (первый участник)

3. **Транскрипция:**
   - Создает WebSocket: `ws://localhost:8080?sessionSlug=abc123&identity=guest-abc123-xyz789`
   - WebSocket сервер создает Gladia bridge для этого соединения
   - Начинает отправлять аудио чанки

4. **В БД:**
   - При первом транскрипте создается `Participant`:
     ```prisma
     {
       videoSessionId: "session-id",
       identity: "guest-abc123-xyz789",
       userId: "user-1-id",  // Если авторизован
       name: "DisplayName1",
       role: "GUEST"
     }
     ```

#### Участник 2 (подключается позже)

1. **Открывает `/session/abc123`:**
   - Получает токен с **новым** `identity = "guest-abc123-def456"`
   - Подключается к **той же** LiveKit комнате `"abc123"`

2. **LiveKit синхронизация:**
   - Участник 1 получает событие `ParticipantConnected`
   - `useParticipants` обновляет список: `[localParticipant, remoteParticipant2]`
   - `VideoGrid` автоматически обновляется, показывает обоих участников

3. **Транскрипция:**
   - Создает **свой** WebSocket: `ws://localhost:8080?sessionSlug=abc123&identity=guest-abc123-def456`
   - WebSocket сервер создает **отдельный** Gladia bridge для этого соединения
   - Начинает отправлять свои аудио чанки

4. **В БД:**
   - При первом транскрипте создается **второй** `Participant`:
     ```prisma
     {
       videoSessionId: "session-id",  // Та же сессия
       identity: "guest-abc123-def456",  // Другой identity
       userId: "user-2-id",
       name: "DisplayName2",
       role: "GUEST"
     }
     ```

5. **Синхронизация транскриптов:**
   - Участник 2 публикует свои транскрипты через `publishData()`
   - Участник 1 получает их через `dataReceived`
   - Оба видят транскрипты друг друга в `TranscriptSidebar`

#### Участник 3 (подключается еще позже)

1. **Тот же процесс:**
   - Получает токен с `identity = "guest-abc123-ghi789"`
   - Подключается к той же комнате

2. **LiveKit:**
   - Участники 1 и 2 получают событие `ParticipantConnected`
   - Все трое видят друг друга в `VideoGrid`
   - Layout автоматически меняется на сетку 2x2 или 3x3

3. **Транскрипция:**
   - Создает свой WebSocket с `identity=guest-abc123-ghi789`
   - Создается третий Gladia bridge
   - Все три участника транскрибируются параллельно

4. **В БД:**
   - Создается третий `Participant` с уникальным `identity`
   - Все транскрипты сохраняются с правильным `participantId`

5. **Синхронизация:**
   - Все участники получают транскрипты всех остальных
   - `TranscriptSidebar` показывает транскрипты с аватарами каждого участника

---

## 5. Ключевые моменты архитектуры

### 5.1. Identity и участники

- **Identity** — уникальный идентификатор участника в рамках LiveKit комнаты
- Генерируется случайно: `guest-${slug}-${random}`
- Один `identity` = один участник в сессии
- В БД хранится в `Participant.identity` с уникальным индексом `[videoSessionId, identity]`

### 5.2. LiveKit комнаты

- **Room name = Session slug**
- Одна сессия = одна LiveKit комната
- Все участники подключаются к одной комнате
- LiveKit автоматически синхронизирует видео/аудио между участниками

### 5.3. Транскрипция

- **Каждый участник имеет свой WebSocket** к транскрипционному серверу
- **Каждый WebSocket имеет свой Gladia bridge**
- Транскрипты помечаются `speakerId` = `identity` участника
- Транскрипты распространяются через LiveKit `publishData()` / `dataReceived`

### 5.4. Синхронизация состояния

- **LiveKit управляет:** видео/аудио треки, подключение/отключение участников
- **React хуки управляют:** UI обновления при изменении участников
- **WebSocket сервер управляет:** транскрипция и сохранение в БД
- **БД хранит:** сессии, участники, транскрипты

### 5.5. Отключение участника

1. **Пользователь нажимает "Leave":**
   - Вызывается `room.disconnect()`
   - LiveKit отключает участника
   - Другие участники получают событие `ParticipantDisconnected`

2. **В БД (опционально):**
   - Можно вызвать `markParticipantLeft(sessionId, identity)`
   - Устанавливается `leftAt = new Date()`
   - Участник остается в БД для истории

3. **Транскрипция:**
   - WebSocket соединение закрывается
   - Gladia bridge закрывается
   - Транскрипция останавливается

---

## 6. API Endpoints

### Создание сессии
```
POST /api/sessions
Body: { title?: string, spaceId?: string }
Response: { slug: string }
```

### Получение токена
```
GET /api/sessions/[slug]/token?name=DisplayName
Response: { token: string, roomName: string, identity: string, serverUrl: string }
```

### Удаление сессии
```
DELETE /api/sessions/[slug]
Response: { success: true }
```

### Получение данных участника
```
GET /api/sessions/[slug]/participants/[identity]
Response: { id, sessionId, userId, identity, name, role, user: { displayName, avatarUrl, noAvatarColor } }
```

### Список сессий
```
GET /api/sessions
Response: { sessions: Session[] }
```

---

## 7. Потоки данных

### 7.1. Видео/Аудио поток

```
Участник 1 (браузер)
  ↓ WebRTC
LiveKit сервер
  ↓ WebRTC
Участник 2 (браузер)
```

### 7.2. Транскрипция поток

```
Участник 1 (браузер)
  ↓ WebSocket (аудио чанки)
WebSocket сервер
  ↓ API
Gladia
  ↓ WebSocket (транскрипты)
WebSocket сервер
  ↓ WebSocket
Участник 1 (браузер)
  ↓ publishData()
LiveKit
  ↓ dataReceived
Участник 2 (браузер)
```

### 7.3. Сохранение транскриптов

```
WebSocket сервер
  ↓ appendTranscriptChunk()
Prisma
  ↓
PostgreSQL
  ↓
Participant (создается/обновляется)
TranscriptSegment (сохраняется)
```

---

## 8. Важные детали реализации

### 8.1. Identity генерация

- Identity генерируется **случайно** для каждого подключения
- Формат: `guest-${slug}-${random}`
- Это означает, что один пользователь может иметь разные `identity` при повторных подключениях
- В БД участник обновляется по `[videoSessionId, identity]`, но если `identity` новый — создается новый участник

### 8.2. Транскрипция и дублирование

- **Локальный echo protection:** транскрипты от локального участника игнорируются в `useTranscriptStream`
- Это предотвращает показ собственных транскриптов дважды (от WebSocket и от LiveKit)

### 8.3. Обновление UI

- `useParticipants` автоматически обновляется при подключении/отключении участников
- `VideoGrid` реагирует на изменения треков через события LiveKit
- `TranscriptSidebar` загружает данные участников лениво при появлении новых сообщений

### 8.4. Масштабирование

- **LiveKit** управляет WebRTC соединениями и может масштабироваться
- **WebSocket сервер** обрабатывает транскрипцию — каждый участник = одно соединение
- **БД** хранит все данные и может масштабироваться через индексы

---

## 9. Примеры использования

### Создание сессии и подключение

```typescript
// 1. Создание
const res = await fetch('/api/sessions', {
  method: 'POST',
  body: JSON.stringify({ title: 'Team Meeting' })
})
const { slug } = await res.json()

// 2. Переход на сессию
router.push(`/session/${slug}`)

// 3. На странице сессии автоматически:
// - Получается токен
// - Подключается к LiveKit
// - Запускается транскрипция
```

### Подключение нескольких участников

```typescript
// Участник 1: открывает /session/abc123
// - Получает identity: "guest-abc123-xyz789"
// - Подключается к комнате "abc123"

// Участник 2: открывает /session/abc123
// - Получает identity: "guest-abc123-def456"
// - Подключается к той же комнате "abc123"
// - Участник 1 видит подключение через ParticipantConnected

// Участник 3: открывает /session/abc123
// - Получает identity: "guest-abc123-ghi789"
// - Все трое видят друг друга в VideoGrid
```

---

## 10. Заключение

Система сессий построена на следующих принципах:

1. **LiveKit** управляет видеосвязью и синхронизацией участников
2. **WebSocket сервер** обрабатывает транскрипцию параллельно для каждого участника
3. **БД** хранит метаданные (сессии, участники, транскрипты)
4. **React** управляет UI и автоматически обновляется при изменениях

При подключении нескольких участников:
- Каждый получает уникальный `identity`
- Все подключаются к одной LiveKit комнате
- Каждый имеет свой WebSocket для транскрипции
- Все видят друг друга и получают транскрипты всех участников
- UI автоматически обновляется при подключении/отключении


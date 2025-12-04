# AI Слой Поверх Сессий — Детальное Описание

## Обзор

AI слой (`src/modules/core/intelligence/`) предоставляет realtime-анализ транскриптов сессий для генерации:
- **AI-названий сессий** (`aiTitle`) — **персистентны в БД**
- **Текущей темы обсуждения** (`currentTopicLabel`) — **персистентна в БД, обновляется быстро, синхронизирована с topics**
- **Live Topic Map** (карта тем, которые возникли в разговоре) — **персистентна в БД**

**Ключевой принцип:** `topics[]` является **единым источником истины** для обоих UI-компонентов (`CurrentTopicBubble` сверху и `TopicToastStack` снизу). Они обновляются синхронно в одном рендере, без задержек.

**Важно:** AI-состояние **сохраняется в БД** в полях `VideoSession.aiTitle`, `VideoSession.aiCurrentTopic`, `VideoSession.aiTopicsJson`. При перезагрузке страницы или возврате в сессию состояние восстанавливается из БД (гидрация).

---

## Архитектура

### Структура модуля

```
src/modules/core/intelligence/
├── domain/
│   ├── intelligence.types.ts    # Реэкспорт типов
│   ├── insight.types.ts          # AiSessionInsights, AiInsightsInput
│   └── topic.types.ts            # AiTopic
├── application/
│   └── realtime/
│       └── extractRealtimeInsights.ts  # Основной use-case
├── infra/
│   └── openai/
│       ├── openai.client.ts            # Клиент для OpenAI API
│       └── openai.prompt-templates.ts   # Промпты и парсинг ответов
└── api/
    └── realtime-insights.endpoint.ts    # HTTP-эндпоинт (сохраняет в БД)
```

**Принцип изоляции:** Модуль `intelligence` не знает про persistence — сохранение происходит через `sessions` модуль (`saveSessionAiInsights` use-case).

### Поток данных (Realtime)

```
[TranscriptContext] 
    ↓ (transcripts: TranscriptBubbleState[])
[useSessionAiEngine hook]
    ↓ (собирает transcript window, проверяет условия)
[POST /api/sessions/[slug]/ai/realtime-insights]
    ↓ (realtimeInsightsEndpoint)
[extractRealtimeInsights]
    ↓ (buildRealtimeInsightsPrompt)
[OpenAI API (gpt-4o-mini)]
    ↓ (JSON response)
[parseRealtimeInsightsResponse]
    ↓ (AiSessionInsights)
[saveSessionAiInsights] ← persistence через sessions модуль
    ↓ (updateSessionAiMetadata в БД)
[useSessionAiEngine hook]
    ↓ (setInsights(data) - ОДИН вызов)
[React re-render]
    ↓ (в одном рендере обновляются оба компонента)
[CurrentTopicBubble] ← currentTopicLabel = topics[topics.length - 1].label
[TopicToastStack] ← topics[]
```

### Поток данных (Гидрация при заходе в сессию)

```
[Пользователь заходит в сессию]
    ↓
[page.tsx (Server Component)]
    ↓ (await getSessionBySlug({ slug }))
[getSessionBySlug (server)]
    ↓ (возвращает Session с aiTitle, aiCurrentTopic, aiTopicsJson из БД)
[getInitialAiInsights(session)]
    ↓ (преобразует данные БД в AiSessionInsights на сервере)
[SessionPageClient (client component)]
    ↓ (получает initialAiInsights через пропсы сразу при первом рендере)
[useSessionAiEngine]
    ↓ (инициализируется с initialInsights из пропсов)
[React render]
    ↓ (отображает восстановленное состояние БЕЗ задержки)
[CurrentTopicBubble] ← показывает последнюю тему из БД сразу
[TopicToastStack] ← показывает последние темы из БД сразу
```

**Ключевое отличие:** Гидрация происходит на сервере, `initialAiInsights` доступны сразу при первом рендере клиентского компонента. Нет "мигания" пустого состояния.

---

## Детальный Процесс

### 1. Сбор транскриптов

**Хук:** `useSessionAiEngine({ sessionSlug, transcripts, initialInsights })`

**Источник данных:** `TranscriptContext` предоставляет массив `TranscriptBubbleState[]`:
- `text: string` — текст транскрипта
- `isFinal: boolean` — финальный ли транскрипт (не interim)
- `speakerId: string | null`
- `speakerName: string | null`
- `timestamp: number`

**Фильтрация:**
- Используются **только финальные** транскрипты (`isFinal === true`)
- Берутся **последние 20** финальных транскриптов
- Формируется простой текст: `windowChunks.map(c => c.text).join(' ')`

**Формат transcript window:**
```
Speaker1: Привет, как дела? Speaker2: Отлично, давай обсудим новый фича Speaker1: Хорошо, начнем с аутентификации
```

### 2. Условия вызова AI API

AI API вызывается только при выполнении **всех** условий:

#### Константы:
- `MIN_CHARS = 120` — минимум символов в окне транскрипта (должен совпадать с `extractRealtimeInsights` порогом)
- `MIN_FINAL_MESSAGES = 3` — минимум финальных сообщений
- `MIN_INTERVAL_MS = 4000` — минимум времени между вызовами (4 секунды)
- `MIN_NEW_CHARS = 40` — минимум новых символов с последнего вызова

**Важно:** `MIN_CHARS = 120` в хуке должен совпадать с порогом в `extractRealtimeInsights` (120 символов), чтобы избежать "фантомных вызовов" — когда хук решает вызвать AI, но сервер отклоняет запрос как слишком короткий.

#### Проверки:
1. `isCallingRef.current === false` — нет активного вызова
2. `finalChunks.length >= MIN_FINAL_MESSAGES` — достаточно сообщений
3. `windowText.length >= MIN_CHARS` — достаточно текста
4. `now - lastCallAtRef.current >= MIN_INTERVAL_MS` — прошло достаточно времени
5. `charsSinceLastCallRef.current >= MIN_NEW_CHARS` — накопилось достаточно новых символов

**Защита от дублирования:**
- `isCallingRef.current` — флаг, предотвращающий параллельные вызовы
- Счетчик символов сбрасывается: `Math.max(0, charsSinceLastCallRef.current - MIN_NEW_CHARS)`

### 3. HTTP-эндпоинт

**Путь:** `POST /api/sessions/[slug]/ai/realtime-insights`

**Файл:** `src/app/api/sessions/[slug]/ai/realtime-insights/route.ts`

**Обработчик:** `realtimeInsightsEndpoint` в `src/modules/core/intelligence/api/realtime-insights.endpoint.ts`

**Авторизация:**
1. Проверка текущего пользователя (`getCurrentUser()`)
2. Проверка существования сессии (`getSessionBySlug()`)
3. Проверка доступа к space (`getUserRoleInSpace()`)

**Request body:**
```typescript
{
  transcriptWindow: {
    text: string  // простой текст из последних 20 финальных транскриптов
  },
  previousInsights?: AiSessionInsights | null  // предыдущие инсайты для контекста
}
```

**Response:** `AiSessionInsights` (JSON)

**Важно:** После успешного вычисления инсайтов эндпоинт **автоматически сохраняет их в БД** через `saveSessionAiInsights` (await для обработки ошибок, но не блокирует ответ).

**Логирование:**
- `[Intelligence API] Saving AI insights to DB...` — перед сохранением
- `[Intelligence API] Successfully saved AI insights to DB` — после успешного сохранения
- `[Intelligence API] Failed to save AI insights:` — при ошибке (не критично)

### 4. Генерация инсайтов

**Use-case:** `extractRealtimeInsights(input: AiInsightsInput)`

**Процесс:**

1. **Валидация входных данных:**
   - Если текст < 120 символов → возвращает дефолтные инсайты (сохраняет предыдущие `currentTopic` и `topics`)

2. **Ограничение размера:**
   - Транскрипт обрезается до последних 2000 символов (защита от огромных промптов)

3. **Построение промпта:**
   - `buildRealtimeInsightsPrompt()` создает system и user промпты
   - System промпт описывает задачу и правила
   - User промпт содержит:
     - Session slug
     - Transcript window (последние 1-3 минуты)
     - Previous insights (если есть)

4. **Вызов OpenAI:**
   - Модель: `gpt-4o-mini`
   - Temperature: `0.7`
   - Max tokens: `1000`
   - Response format: `json_object`
   - Endpoint: `https://api.openai.com/v1/chat/completions`

5. **Парсинг ответа:**
   - `parseRealtimeInsightsResponse()` извлекает JSON из ответа
   - Валидирует и нормализует данные
   - **Генерирует стабильные topic IDs** на основе slugified label + index:
     ```typescript
     const generateTopicId = (label: string, index: number): string => {
       const slugified = label
         .toLowerCase()
         .replace(/[^a-z0-9]+/g, '-')
         .replace(/^-+|-+$/g, '')
         .slice(0, 30)
       return `${slugified}-${index}`
     }
     ```
   - **Проверяет инвариант:** Если `currentTopic` не null, но отсутствует в `topics[]`, автоматически добавляет его в массив
   - Вычисляет `topicChanged` на основе сравнения с предыдущим `currentTopic`
   - Возвращает безопасные дефолты при ошибках парсинга

### 5. Промпт и правила AI

**System prompt** (основные правила):

- **Язык:**
  - Определять доминирующий язык транскрипта (русский или английский)
  - Если транскрипт на русском → все поля вывода (aiTitle, currentTopic, topics[*].label) должны быть на русском
  - Использовать естественный, рабочий русский (короткий, понятный, не бюрократический)
  - Темы должны звучать как реальные рабочие заголовки команды, а не формальные метки

- **Инвариант тем:**
  - **КРИТИЧЕСКИ ВАЖНО:** Если `currentTopic` не null, `topics[]` ОБЯЗАН содержать хотя бы одну тему с этим точным label
  - Это обеспечивает синхронизацию UI — `currentTopic` и `topics[]` всегда синхронизированы
  - Если идентифицирована `currentTopic`, она ДОЛЖНА быть добавлена в `topics[]`

- **Текущая тема (`currentTopic`):**
  - Всегда идентифицировать, если есть осмысленное обсуждение (даже при confidence >= 0.6)
  - Быть более агрессивным в идентификации тем
  - **Обязательно заполнять**, если есть хоть какой-то осмысленный фокус

- **Название сессии (`aiTitle`):**
  - Предлагать новое название (`shouldUpdateTitle = true`) если:
    * Есть четкая доминирующая тема (проект, фича, спринт, роадмап, онбординг, название продукта и т.д.)
    * Confidence >= 0.6
    * Текст содержит достаточно содержания (не просто small talk)
  - Если текст слишком короткий или пустой:
    * `shouldUpdateTitle = false`
    * `aiTitle = null`
    * Сохранить предыдущий `currentTopic` если доступен
  - **Optional** — может не меняться долго

- **Live Topic Map (`topics`):**
  - Всегда строить массив с минимум 1-2 темами, если есть осмысленный контент
  - **Topic IDs должны быть стабильными** (slugified label + index) для корректной анимации в Framer Motion
  - Инструкция в промпте: использовать стабильные, slugified IDs

- **Смена темы (`topicChanged`):**
  - `true` если:
    * Новый `currentTopic` отличается от предыдущего
    * `currentTopicConfidence >= 0.6`
  - **Важно:** `topicChanged` — только триггер для анимации, **не блокирует обновление значения** `currentTopic`

**Response format:**
```json
{
  "aiTitle": string | null,
  "aiTitleConfidence": number (0-1),
  "shouldUpdateTitle": boolean,
  "currentTopic": string | null,
  "currentTopicConfidence": number (0-1),
  "topics": Array<{
    "id": string,  // стабильный ID (slugified label + index)
    "label": string,
    "startedAtSec": number | null
  }>,
  "topicChanged": boolean
}
```

### 6. Типы данных

**`AiSessionInsights`:**
```typescript
{
  aiTitle: string | null              // предложенное AI название сессии
  aiTitleConfidence: number           // 0..1
  shouldUpdateTitle: boolean          // можно ли безопасно применять в UI
  currentTopic: string | null          // "Authentication", "Q1 roadmap", ...
  currentTopicConfidence: number      // 0..1
  topics: AiTopic[]                   // Live Topic Map (единый источник истины)
  topicChanged: boolean                // сигнал смены темы (для анимации)
}
```

**`AiTopic`:**
```typescript
{
  id: string              // stable id (slugified label + index)
  label: string           // "Authentication", "Production bugs", ...
  startedAtSec: number | null  // на будущее, пока null
}
```

**`AiInsightsInput`:**
```typescript
{
  sessionSlug: string
  transcriptWindow: {
    text: string  // окно последних реплик (1–3 минуты)
  }
  previousInsights?: AiSessionInsights | null
}
```

### 7. Персистентность в БД

**Схема БД (Prisma):**
```prisma
model VideoSession {
  // ... другие поля ...
  
  // AI metadata
  aiTitle         String?   @db.VarChar(256)
  aiCurrentTopic  String?   @db.VarChar(256)
  aiTopicsJson    Json?     // хранит массив AiTopic
  aiUpdatedAt     DateTime? @db.Timestamp(6)
}
```

**Миграция:** `20241220000000_add_ai_fields_to_video_session`

**Use-case сохранения:** `saveSessionAiInsights` в `src/modules/core/sessions/application/saveSessionAiInsights.ts`

**Логика сохранения:**
```typescript
// aiTitle: сохраняется только если shouldUpdateTitle === true
const nextAiTitle =
  insights.shouldUpdateTitle && insights.aiTitle
    ? insights.aiTitle
    : session.aiTitle ?? null  // не перетираем существующий

// aiCurrentTopic: обновляется всегда, если не null
const aiCurrentTopic = insights.currentTopic ?? session.aiCurrentTopic ?? null

// aiTopicsJson: обновляется только если массив не пустой
const aiTopicsJson =
  insights.topics && insights.topics.length > 0
    ? insights.topics
    : session.aiTopicsJson ?? null  // не перетираем существующие topics
```

**Repository функция:** `updateSessionAiMetadata` в `src/modules/core/sessions/infra/prisma/sessions.repository.ts`

**Логирование:**
- `[saveSessionAiInsights] Saving AI insights:` — параметры сохранения
- `[updateSessionAiMetadata] Updating AI metadata:` — параметры обновления в БД

### 8. Гидрация при заходе в сессию

**Процесс гидрации:**

1. **Запрос данных из БД:**
   - В `SessionPage` (клиентский компонент) при монтировании:
     ```typescript
     useEffect(() => {
       const fetchSessionData = async () => {
         const res = await fetch(`/api/sessions/${slug}`)
         const session = await res.json()
         const insights = getInitialAiInsights(session)
         if (insights) {
           setInitialAiInsights(insights)
         }
       }
       fetchSessionData()
     }, [slug])
     ```

2. **Преобразование данных БД:**
   - `getInitialAiInsights(session)` преобразует данные БД в `AiSessionInsights`:
     ```typescript
     {
       aiTitle: session.aiTitle ?? null,
       aiTitleConfidence: session.aiTitle ? 0.8 : 0,
       shouldUpdateTitle: !!session.aiTitle,
       currentTopic: session.aiCurrentTopic ?? null,
       currentTopicConfidence: session.aiCurrentTopic ? 0.8 : 0,
       topics: Array.isArray(session.aiTopicsJson) ? session.aiTopicsJson : [],
       topicChanged: false,
     }
     ```

3. **Передача в хук:**
   - `initialAiInsights` передаются через пропсы в `SessionContent` → `SessionContentInner`
   - Передаются в `useSessionAiEngine({ sessionSlug, transcripts, initialInsights })`

4. **Инициализация в хуке:**
   - При первом рендере: `useState<AiSessionInsights | null>(initialInsights ?? null)`
   - При изменении `initialInsights` (когда данные загружаются асинхронно):
     ```typescript
     useEffect(() => {
       if (initialInsights) {
         setInsights((prev) => {
           // Если нет prev, используем initial (гидрация)
           if (!prev) return initialInsights
           // Если prev пустые, а initial есть данные, используем initial
           const hasPrevData = prev.aiTitle || prev.currentTopic || prev.topics.length > 0
           const hasInitialData = initialInsights.aiTitle || initialInsights.currentTopic || initialInsights.topics.length > 0
           if (!hasPrevData && hasInitialData) return initialInsights
           // Иначе мержим или оставляем prev
           return prev
         })
       }
     }, [initialInsights])
     ```

**Логирование:**
- `[SessionPage] Fetched session for AI hydration:` — данные из БД
- `[SessionPage] Initial AI insights from DB:` — преобразованные insights
- `[SessionContent] Received initialAiInsights:` — получение в компоненте
- `[SessionAI] Initial insights from DB (hydrating):` — обработка в хуке
- `[SessionAI] ✅ No previous insights, using initial from DB` — успешная гидрация

**Результат:** При возврате в сессию AI-состояние восстанавливается из БД и отображается сразу, до получения новых транскриптов.

### 9. Синхронизация CurrentTopicBubble и TopicToastStack

**Ключевой принцип:** `topics[]` является **единым источником истины** для обоих компонентов.

**Реализация в `useSessionAiEngine`:**

```typescript
// DERIVED STATE — topics[] is the single source of truth
const topics = insights?.topics ?? []

// currentTopicLabel ALWAYS comes from the last topic in topics[]
// This ensures CurrentTopicBubble (top) and TopicToastStack (bottom) are in perfect sync
// They both see the same topics[] update in the same render tick
// CRITICAL: No fallback to insights.currentTopic - topics[] is the ONLY source of truth
const currentTopicLabel =
  topics.length > 0
    ? topics[topics.length - 1].label
    : null  // No fallback - if topics is empty, currentTopicLabel is null
```

**Почему это работает:**

1. **Один источник данных:**
   - Оба компонента получают данные из одного хука `useSessionAiEngine`
   - `CurrentTopicBubble` получает `currentTopicLabel`
   - `TopicToastStack` получает `topics[]`

2. **Один setState:**
   - Когда AI возвращает новые insights, делается **один** `setInsights(data)`
   - React делает **один** re-render
   - В этом рендере оба компонента видят обновленные данные

3. **Производные значения вычисляются синхронно:**
   - `topics = insights?.topics ?? []`
   - `currentTopicLabel = topics.length > 0 ? topics[topics.length - 1].label : ...`
   - Оба вычисляются в одном рендере, до передачи в компоненты

4. **Нет дополнительных задержек:**
   - Нет `setTimeout`, `debounce`, отдельных таймеров
   - Нет отдельных `useEffect` в компонентах, которые ждут изменений
   - Компоненты просто рендерят то, что получили через пропсы

**Использование в UI:**

```typescript
const { aiTitle, currentTopicLabel, topics } = useSessionAiEngine({
  sessionSlug,
  transcripts,
  initialInsights: initialAiInsights ?? null,
})

return (
  <div>
    {/* Current Topic Bubble - Top Center */}
    <CurrentTopicBubble topic={currentTopicLabel} />
    
    {/* Topic Toast Stack - Bottom Left */}
    <TopicToastStack topics={topics} />
  </div>
)
```

**Результат:** Когда AI возвращает новые insights с новым `topics[]`:
- `TopicToastStack` видит новый массив и отрисовывает новый bubble снизу
- `CurrentTopicBubble` видит `currentTopicLabel = topics[topics.length - 1].label` и отрисовывает тот же label сверху
- Оба обновляются **синхронно в одном рендере**, без задержек

### 10. Отображение в UI

**Компонент:** `src/app/session/[slug]/page.tsx`

**Использование:**
```typescript
// topics[] is the single source of truth for both CurrentTopicBubble and TopicToastStack
const { aiTitle, currentTopicLabel, topics } = useSessionAiEngine({
  sessionSlug,
  transcripts,
  initialInsights: initialAiInsights ?? null,
})

// Display title: AI title or session title or default session slug
const displayTitle = aiTitle ?? `Session ${sessionSlug}`
```

**UI-компоненты (изолированы в `shared/ui/session-ai/**`):**

1. **CurrentTopicBubble** (`src/shared/ui/session-ai/current-topic-bubble/CurrentTopicBubble.tsx`):
   - **Проп:** `topic: string | null` — просто строка, никакой дополнительной логики
   - Bubble вверху по центру экрана
   - Framer Motion анимации (spring, smooth transitions)
   - Фильтрует общие/короткие темы (< 3 символов, generic topics)
   - Показывается только если тема осмысленная
   - **Важно:** Не вычисляет тему внутри, не работает с `topics[]`, не использует таймеры

2. **TopicToastStack** (`src/shared/ui/session-ai/topic-toast-stack/TopicToastStack.tsx`):
   - **Проп:** `topics: AiTopic[]` — массив тем напрямую из хука
   - Stack тостов внизу слева
   - Показывает последние 4 темы (`topics.slice(-4)`)
   - Framer Motion анимации (spring, smooth entry/exit)
   - Подсветка текущей темы (последний элемент): `data-current={topic.id === currentId}`
   - Стабильные IDs для корректной анимации
   - **Важно:** Использует `topics` напрямую в `map`, не вычисляет отдельно

3. **AI Title Header** (встроен в страницу):
   - В левом верхнем углу
   - Показывает `displayTitle` (aiTitle или session.title или slug)

**Отображение:**
```tsx
<div className="relative flex flex-col h-full">
  {/* AI Title Header - Top Left */}
  <div className="absolute top-4 left-4 z-50 pointer-events-none">
    <div className="flex flex-col gap-1 bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg">
      <h1 className="text-sm font-medium text-white">{displayTitle}</h1>
    </div>
  </div>

  {/* Current Topic Bubble - Top Center */}
  <CurrentTopicBubble topic={currentTopicLabel} />

  {/* Topic Toast Stack - Bottom Left */}
  <TopicToastStack topics={topics} />

  {/* Video grid, controls, etc. */}
</div>
```

### 11. Отображение в списке сессий

**Файл:** `src/app/sessions/SessionsPageClient.tsx`

**Логика:**
```typescript
const title = session.aiTitle ?? session.title ?? `Session ${session.slug}`
```

**Компонент:** `SessionCard` в `src/shared/ui/session-card/SessionCard.tsx`:
- Принимает `aiTitle` как проп
- Использует приоритет: `aiTitle` → `title` → `slug`
- `displayTitle = aiTitle || title || Session ${slug.slice(0, 8)}`

**Repository:** `listSessionsBySpace` в `src/modules/core/sessions/infra/prisma/sessions.repository.ts`:
- Включает AI-поля (`aiTitle`, `aiCurrentTopic`, `aiTopicsJson`, `aiUpdatedAt`) в маппинг всех сессий

**Результат:** В списке сессий отображается AI-название, если оно есть в БД.

---

## Критические Механизмы

### 1. topics[] как единый источник истины

**Проблема:** Раньше `currentTopic` и `topics` могли обновляться в разное время, что создавало визуальную рассинхронизацию.

**Решение:**
- `topics[]` — единственный источник данных о темах
- `currentTopicLabel` **всегда** вычисляется из последнего элемента `topics[]`
- Оба компонента получают данные из одного хука в одном рендере

**Код:**
```typescript
const topics = insights?.topics ?? []

// CRITICAL: No fallback to insights.currentTopic - topics[] is the ONLY source of truth
const currentTopicLabel =
  topics.length > 0
    ? topics[topics.length - 1].label
    : null  // No fallback - if topics is empty, currentTopicLabel is null
```

**Результат:** Когда AI возвращает новый `topics[]`, оба компонента видят обновление одновременно.

### 2. Один setState для синхронизации

**Проблема:** Множественные `setState` или отдельные обновления могли создавать разные рендеры.

**Решение:**
- Один `setInsights(data)` при получении новых insights от API
- Все производные значения (`topics`, `currentTopicLabel`) вычисляются синхронно в одном рендере
- Нет отдельных `useState` для `currentTopic` или `topics`
- Нет fallback к `insights.currentTopic` — только `topics[]` как источник истины

### 2.1. Инвариант: currentTopic всегда в topics[]

**Проблема:** Модель может вернуть `currentTopic`, но `topics = []`, что создает рассинхронизацию.

**Решение:**
- В промпте явно указано: если `currentTopic` не null, `topics[]` должен содержать хотя бы одну тему с этим label
- В коде парсинга (`parseRealtimeInsightsResponse`) проверяется инвариант: если `currentTopic` не null, но отсутствует в `topics[]`, он автоматически добавляется
- На клиенте нет fallback к `insights.currentTopic` — только последний элемент `topics[]`

**Код:**
```typescript
const data = (await res.json()) as AiSessionInsights

// Single setInsights call - both topics and currentTopicLabel will update in the same render
setInsights((prev) => {
  if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev
  return data
})
```

### 3. Гидрация при заходе в сессию

**Проблема:** При выходе и возврате в сессию AI-состояние терялось, так как оно было только в клиентском состоянии.

**Решение (серверная гидрация через RSC):**
1. **Сохранение в БД:** Каждый раз при получении insights они сохраняются в БД
2. **Загрузка на сервере:** При заходе в сессию `page.tsx` (Server Component) вызывает `getSessionBySlug({ slug })` на сервере
3. **Преобразование на сервере:** `getInitialAiInsights(session)` преобразует данные БД в формат `AiSessionInsights` на сервере
4. **Передача через пропсы:** `initialAiInsights` передаются в `SessionPageClient` (client component) через пропсы
5. **Инициализация:** `useSessionAiEngine` инициализируется с `initialInsights` из пропсов сразу при первом рендере
6. **Обновление:** `useEffect` реагирует на изменение `initialInsights` и обновляет состояние, если оно пустое

**Реализация:**
```typescript
// page.tsx (server component)
export default async function SessionPage({ params }: PageProps) {
  const slug = params.slug
  const session = await getSessionBySlug({ slug })
  const initialAiInsights = getInitialAiInsights(session)
  return <SessionPageClient sessionSlug={slug} initialAiInsights={initialAiInsights} />
}
```

**UX-преимущество:** `initialAiInsights` доступны сразу при первом рендере клиентского компонента. Нет "мигания" пустого состояния, нет задержки 100-500мс. AI-состояние отображается мгновенно при входе в сессию.

**Код гидрации:**
```typescript
// В SessionPage
useEffect(() => {
  const fetchSessionData = async () => {
    const res = await fetch(`/api/sessions/${slug}`)
    const session = await res.json()
    const insights = getInitialAiInsights(session)
    if (insights) {
      setInitialAiInsights(insights)
    }
  }
  fetchSessionData()
}, [slug])

// В useSessionAiEngine
useEffect(() => {
  if (initialInsights) {
    setInsights((prev) => {
      if (!prev) return initialInsights  // гидрация при первом заходе
      // логика мержа или сохранения prev
    })
  }
}, [initialInsights])
```

**Результат:** При возврате в сессию сразу видны последние `aiTitle`, `currentTopic` и `topics` из БД.

### 4. Персистентность с умным сохранением

**Проблема:** Нужно сохранять данные в БД, но не перетирать существующие без необходимости.

**Решение:**
- `aiTitle`: сохраняется только если `shouldUpdateTitle === true` и `aiTitle` не null
- `aiCurrentTopic`: обновляется всегда, если не null
- `aiTopicsJson`: обновляется только если массив не пустой (не перетираем существующие topics)

**Код:**
```typescript
const nextAiTitle =
  insights.shouldUpdateTitle && insights.aiTitle
    ? insights.aiTitle
    : session.aiTitle ?? null  // не перетираем

const aiCurrentTopic = insights.currentTopic ?? session.aiCurrentTopic ?? null

const aiTopicsJson =
  insights.topics && insights.topics.length > 0
    ? insights.topics
    : session.aiTopicsJson ?? null  // не перетираем
```

---

## Особенности и Ограничения

### Rate Limiting

- Минимум 4 секунды между вызовами (`useSessionAiEngine`)
- Счетчик новых символов предотвращает слишком частые вызовы
- Порог в 120 символов для вызова AI (должен совпадать с серверным порогом в `extractRealtimeInsights`)
- Минимум 40 новых символов с последнего вызова

### Обработка ошибок

- При ошибке OpenAI API возвращаются безопасные дефолты (сохраняются предыдущие `currentTopic` и `topics`)
- При ошибке парсинга JSON также возвращаются дефолты
- При ошибке сохранения в БД — логируется, но не прерывает работу (await для обработки, но не блокирует ответ)
- Ошибки логируются в консоль, но не прерывают работу UI

### Производительность

- Транскрипт ограничен до 2000 символов перед отправкой в OpenAI
- Используется модель `gpt-4o-mini` (быстрая и дешевая)
- Max tokens: 1000 (достаточно для JSON-ответа)
- Сохранение в БД происходит асинхронно (не блокирует ответ)
- Один `setState` для всех обновлений — минимум re-renders

### Консистентность данных

- **Инвариант:** Если `currentTopic` не null, `topics[]` всегда содержит хотя бы одну тему с этим label (проверяется в `parseRealtimeInsightsResponse`)
- `topicChanged` вычисляется на основе сравнения с предыдущим `currentTopic`
- `topics` накапливаются между вызовами (AI может добавлять новые темы)
- `aiTitle` обновляется только если `shouldUpdateTitle === true`
- Стабильные topic IDs обеспечивают корректную анимацию в Framer Motion
- `topics[]` — единый источник истины для синхронизации UI
- На клиенте нет fallback к `insights.currentTopic` — только последний элемент `topics[]`

### Изоляция модулей

- **Intelligence модуль** не знает про persistence
- **Sessions модуль** отвечает за сохранение AI-метаданных
- **UI-компоненты** изолированы в `shared/ui/session-ai/**`
- Четкое разделение ответственности

---

## Отладка

### Логирование

**В `SessionPage` (server component):**
- `[SessionPage (server)] Fetched session for AI hydration:` — данные из БД на сервере
- Логирует `initialAiInsights` с деталями (aiTitle, currentTopic, topicsCount)

**В `SessionContent`:**
- `[SessionContent] Received initialAiInsights (from server):` — получение в компоненте (гидрация с сервера)

**В `useSessionAiEngine`:**
- `[SessionAI] Initial insights from DB (hydrating):` — обработка гидрации
- `[SessionAI] ✅ No previous insights, using initial from DB` — успешная гидрация
- `[SessionAI] ✅ Previous insights empty, using initial from DB` — гидрация при пустом состоянии
- `[SessionAI] Calling AI insights API...` — начало вызова
- `[SessionAI] Received insights:` — получены инсайты
- `[SessionAI] Derived state:` — производные значения (topics, currentTopicLabel)

**В `realtimeInsightsEndpoint`:**
- `[Intelligence API] Saving AI insights to DB...` — перед сохранением
- `[Intelligence API] Successfully saved AI insights to DB` — после сохранения
- `[Intelligence API] Failed to save AI insights:` — ошибка сохранения

**В `saveSessionAiInsights`:**
- `[saveSessionAiInsights] Saving AI insights:` — параметры сохранения
- `[saveSessionAiInsights] Session not found:` — предупреждение

**В `updateSessionAiMetadata`:**
- `[updateSessionAiMetadata] Updating AI metadata:` — параметры обновления в БД

**В `extractRealtimeInsights`:**
- `[Intelligence] Parsed OpenAI response:` — успешный парсинг
- `[Intelligence] Failed to extract realtime insights:` — ошибка

**В `parseRealtimeInsightsResponse`:**
- `[Intelligence] No JSON found in OpenAI response` — предупреждение

### Проверка состояния

В консоли браузера можно отследить:
- Условия вызова AI (текст, количество сообщений, время с последнего вызова)
- Полученные инсайты (название, тема, темы, confidence)
- Ошибки API
- Состояние гидрации (initialInsights)
- Производные значения (topics, currentTopicLabel)
- Процесс сохранения в БД

### Типичные проблемы и решения

**Проблема:** CurrentTopicBubble отстает от TopicToastStack
- **Причина:** Разные источники данных или отдельные обновления, fallback к `insights.currentTopic`
- **Решение:** Использовать `topics[]` как единый источник, `currentTopicLabel` из последнего элемента, убрать fallback

**Проблема:** Bubble сверху показывает тему, но stack снизу пустой
- **Причина:** Модель вернула `currentTopic`, но `topics = []`, и используется fallback к `insights.currentTopic`
- **Решение:** Убрать fallback, добавить инвариант в парсинг (автоматически добавлять `currentTopic` в `topics[]`)

**Проблема:** При возврате в сессию нет истории
- **Причина:** Гидрация не работает или `initialInsights` не передаются
- **Решение:** Проверить логи `[SessionPage] Fetched session` и `[SessionAI] Initial insights from DB`

**Проблема:** aiTitle не показывается в списке сессий
- **Причина:** AI-поля не включены в маппинг `listSessionsBySpace`
- **Решение:** Убедиться, что все места маппинга включают `aiTitle`, `aiCurrentTopic`, `aiTopicsJson`

**Проблема:** "Фантомные вызовы" — хук вызывает AI, но сервер отклоняет
- **Причина:** Несовпадение порогов (`MIN_CHARS = 80` в хуке vs `120` в `extractRealtimeInsights`)
- **Решение:** Выровнять пороги — `MIN_CHARS = 120` в хуке должен совпадать с серверным порогом

**Проблема:** Темы на английском в русском созвоне
- **Причина:** Промпт не учитывает язык транскрипта
- **Решение:** Добавлена поддержка языка в промпты — модель определяет язык и использует его для всех полей вывода

---

## Связанные файлы

### Core модуль
- `src/modules/core/intelligence/` — весь AI модуль (domain, application, infra, api)
- `src/modules/core/sessions/application/saveSessionAiInsights.ts` — use-case сохранения
- `src/modules/core/sessions/infra/prisma/sessions.repository.ts` — `updateSessionAiMetadata`, маппинг AI-полей

### Хуки
- `src/hooks/useSessionAiEngine.ts` — основной хук (единый источник истины, синхронизация)
- `src/hooks/useMeetingAiEngine.ts` — deprecated, для совместимости

### API
- `src/app/api/sessions/[slug]/ai/realtime-insights/route.ts` — HTTP route
- `src/app/api/sessions/[slug]/route.ts` — GET endpoint для гидрации
- `src/modules/core/intelligence/api/realtime-insights.endpoint.ts` — обработчик (сохраняет в БД)

### UI
- `src/app/session/[slug]/page.tsx` — серверный компонент страницы (получает сессию и initialAiInsights на сервере)
- `src/app/session/[slug]/SessionPageClient.tsx` — клиентский компонент страницы (использует AI, получает initialAiInsights через пропсы)
- `src/shared/ui/session-ai/current-topic-bubble/CurrentTopicBubble.tsx` — bubble текущей темы (top center)
- `src/shared/ui/session-ai/topic-toast-stack/TopicToastStack.tsx` — stack тем (bottom left)
- `src/shared/ui/session-card/SessionCard.tsx` — карточка сессии (показывает aiTitle)

### Утилиты
- `src/app/session/[slug]/getInitialAiInsights.ts` — преобразование БД → AiSessionInsights

### Контекст
- `src/contexts/TranscriptContext.tsx` — источник транскриптов

### БД
- `prisma/schema.prisma` — схема с AI-полями
- `prisma/migrations/20241220000000_add_ai_fields_to_video_session/` — миграция

---

## Заключение

AI слой работает с **полной персистентностью и синхронизацией**:

- ✅ Анализирует транскрипты по мере их поступления
- ✅ Генерирует названия и темы для отображения в UI
- ✅ **Сохраняет** результаты в БД (aiTitle, aiCurrentTopic, aiTopicsJson)
- ✅ **Восстанавливает** состояние при перезагрузке/возврате в сессию (гидрация)
- ✅ **Быстро обновляет** currentTopic без блокировок
- ✅ **Синхронизирует** CurrentTopicBubble и TopicToastStack через topics[] как единый источник истины
- ✅ **Красивые UI-компоненты** с Framer Motion анимациями
- ✅ **Отображает aiTitle** в списке сессий

**Архитектурные принципы соблюдены:**
- Модуль intelligence не расползся — persistence через sessions-модуль
- UI-компоненты изолированы в `shared/ui/session-ai/**`
- `useSessionAiEngine` — единый источник истины для AI-состояния на клиенте
- `topics[]` — единый источник истины для синхронизации UI-компонентов
- Current topic обновляется быстро, без блокировок, синхронно с topics
- Поддержка языка (RU/EN) в промптах для нативного опыта

**Критические механизмы:**
- Один `setState` для всех обновлений → синхронный рендер
- `currentTopicLabel` всегда из последнего элемента `topics[]` → визуальная синхронизация
- **Инвариант:** Если `currentTopic` не null, `topics[]` всегда содержит его → нет рассинхронизации
- **Нет fallback** к `insights.currentTopic` на клиенте → `topics[]` единственный источник
- Выровненные пороги (`MIN_CHARS = 120`) → нет "фантомных вызовов"
- Гидрация через `initialInsights` → восстановление состояния при заходе в сессию
- Умное сохранение → не перетираем существующие данные без необходимости

**Будущие улучшения:**
- Ограничение размера `aiTopicsJson` (cap на 30-50 тем) → оптимизация БД

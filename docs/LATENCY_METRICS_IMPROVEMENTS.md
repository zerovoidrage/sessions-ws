# Улучшение метрик латентности транскрипции

Документ описывает доработки системы метрик для точного измерения и анализа задержек в пайплайне транскрипции.

---

## Проблема

До доработок наблюдались следующие проблемы:

1. **Метрика `stt.end_to_transcript_ms` возвращала `null`** — не записывалась корректно
2. **Метрика `gladia.stt_latency_ms` была бесполезной** — показывала ~0-1ms из-за использования фиктивных таймингов
3. **Визуальная задержка транскрипции** — иногда 2-3 секунды, иногда мгновенно, без понимания причины
4. **Interim транскрипты не показывались мгновенно** — пользователь видел текст только после финализации

---

## Выполненные доработки

### 1. Исправление метрики `stt.end_to_transcript_ms`

**Файл:** `server/rtmp-ingest.ts`

**Проблема:**
- Метрика не записывалась корректно
- Не было предупреждений при высоких задержках

**Решение:**
- Убедились, что `lastAudioChunkSentAt` обновляется при каждой отправке аудио чанка в `startFFmpegDecoder()`
- Добавили корректную запись метрики в `handleTranscript()`:
  ```typescript
  if (this.lastAudioChunkSentAt) {
    const diff = now - this.lastAudioChunkSentAt
    recordLatency('stt.end_to_transcript_ms', diff)
    
    // Предупреждение при высоких задержках
    if (diff > 2000) {
      console.warn('[METRICS] ⚠️ High STT latency', {
        sessionId: this.config.sessionId,
        sessionSlug: this.config.sessionSlug,
        diffMs: diff,
        isFinal: event.isFinal,
        textPreview: event.text.slice(0, 80),
      })
    }
  }
  ```
- Добавили сброс телеметрии при остановке FFmpeg для предотвращения устаревших метрик

**Результат:**
- Метрика теперь записывается корректно
- Появляются предупреждения при задержках > 2000ms
- Можно точно отслеживать задержку от отправки аудио до получения транскрипта

---

### 2. Обновление метрики Gladia

**Файл:** `server/gladia-bridge.ts`

**Проблема:**
- Использовались фиктивные тайминги (`new Date()`) вместо реальных от Gladia
- Метрика `gladia.stt_latency_ms` показывала ~0-1ms (бесполезно)

**Решение:**
- Обновили `parseTranscriptMessage()` для извлечения реальных таймингов от Gladia:
  ```typescript
  // Извлекаем реальные тайминги от Gladia (если есть)
  let startedAt: Date | undefined
  let endedAt: Date | undefined
  
  // Проверяем различные возможные поля для таймингов
  if (data.timestamp) {
    startedAt = new Date(data.timestamp)
  } else if (data.start_time) {
    startedAt = new Date(data.start_time)
  } else if (data.utterance?.start_time) {
    startedAt = new Date(data.utterance.start_time)
  }
  
  if (isFinal) {
    // Для финальных транскриптов проверяем end_time
    if (data.end_time) {
      endedAt = new Date(data.end_time)
    } else if (data.utterance?.end_time) {
      endedAt = new Date(data.utterance.end_time)
    }
    // НЕ используем data.timestamp как fallback для endedAt
  }
  ```
- Обновили логику записи метрики `gladia.stt_latency_ms`:
  ```typescript
  // Записываем метрику только если endedAt был получен от Gladia (реальный тайминг)
  if (transcriptEvent.isFinal && transcriptEvent.endedAt) {
    const endedAtTime = transcriptEvent.endedAt.getTime()
    const sttLatency = receivedAt - endedAtTime
    
    // Записываем метрику только если latency осмысленная
    if (sttLatency > 0 && sttLatency < 10000) {
      recordLatency('gladia.stt_latency_ms', sttLatency)
    }
  }
  ```

**Результат:**
- Метрика записывается только для реальных таймингов от Gladia
- Если Gladia не дает таймингов, метрика не записывается (основной источник правды — `stt.end_to_transcript_ms`)

---

### 3. Улучшение обработки interim-транскриптов на фронте

**Файл:** `src/hooks/useRealtimeTranscript.ts`

**Проблема:**
- Interim транскрипты не показывались мгновенно
- Пользователь видел текст только после финализации
- Зависшие draft сообщения создавали ощущение "подвисания"

**Решение:**
- Улучшили логику обработки финальных транскриптов:
  ```typescript
  if (data.isFinal) {
    // Проверяем, есть ли уже текущий utterance с таким же id
    setCurrentUtterance((prev) => {
      if (prev && prev.id === base.id) {
        // Обновляем существующий и добавляем в messages
        setMessages((m) => [...m, { ...base, isFinal: true }])
        return null
      }
      return prev
    })
    
    // Если не было текущего с таким id - просто добавляем в messages
    setMessages((prev) => {
      const exists = prev.some((m) => m.id === base.id)
      if (exists) return prev
      return [...prev, base]
    })
  } else {
    // Interim транскрипт - всегда показываем мгновенно как currentUtterance
    setCurrentUtterance(base)
    currentUtteranceRef.current = base
  }
  ```
- Улучшили замер клиентской latency:
  ```typescript
  const serverTs = data.ts ?? now
  const clientLatency = now - serverTs

  if (clientLatency > 2000) {
    console.warn('[CLIENT_METRICS] ⚠️ High client-side transcript latency', {
      clientLatency,
      isFinal: data.isFinal,
      textPreview: data.text?.slice(0, 80),
    })
  }
  ```
- Авто-финализация draft сообщений через 3000ms без обновлений (уже была реализована ранее)

**Результат:**
- Interim транскрипты показываются мгновенно
- Улучшена логика обработки финальных транскриптов
- Авто-финализация убирает ощущение "подвисания"

---

## Доступные метрики

### Backend метрики (HTTP `/metrics`)

#### Latency метрики

1. **`stt.end_to_transcript_ms`** — основная метрика задержки
   - **Описание:** Время от отправки последнего аудио чанка до получения транскрипта
   - **Охватывает:** FFmpeg → Gladia → наш код
   - **Цель:** < 1500ms
   - **Пример:**
     ```json
     {
       "count": 51,
       "avgMs": 71.6,
       "minMs": 3,
       "maxMs": 313
     }
     ```

2. **`gladia.stt_latency_ms`** — задержка обработки в Gladia
   - **Описание:** Время от окончания транскрипта (endedAt) до получения сообщения
   - **Охватывает:** Только обработку в Gladia (если есть реальный endedAt)
   - **Цель:** < 800ms
   - **Примечание:** Записывается только для финальных транскриптов с реальными таймингами от Gladia

3. **`gladia.message_gap_ms`** — промежутки между сообщениями от Gladia
   - **Описание:** Время между двумя последовательными сообщениями от Gladia
   - **Цель:** < 200ms
   - **Пример:**
     ```json
     {
       "count": 1600,
       "avgMs": 64,
       "minMs": 0,
       "maxMs": 111
     }
     ```

4. **`ingest.broadcast_latency_ms`** — задержка обработки в ingest
   - **Описание:** Время обработки транскрипта в ingest до отправки клиентам
   - **Цель:** < 10ms
   - **Пример:**
     ```json
     {
       "count": 151,
       "avgMs": 0.2,
       "minMs": 0,
       "maxMs": 1
     }
     ```

5. **`ws.broadcast_loop_ms`** — задержка WebSocket broadcast
   - **Описание:** Время выполнения broadcastToSessionClients
   - **Цель:** < 5ms
   - **Пример:**
     ```json
     {
       "count": 151,
       "avgMs": 0.19,
       "minMs": 0,
       "maxMs": 1
     }
     ```

6. **`ingest.processing_latency_ms`** — задержка обработки в ingest
   - **Описание:** Время от получения транскрипта от Gladia до обработки в нашем коде
   - **Цель:** < 50ms

7. **`audio.chunk_size_bytes`** — размер аудио чанков
   - **Описание:** Размер отправляемых аудио чанков в байтах
   - **Цель:** ~2000-3000 bytes (~125-188ms аудио)
   - **Пример:**
     ```json
     {
       "count": 1600,
       "avgMs": 2167,
       "minMs": 710,
       "maxMs": 2974
     }
     ```

#### Counter метрики

1. **`audio.chunks_sent`** — количество отправленных аудио чанков
2. **`gladia.messages_total`** — общее количество сообщений от Gladia
3. **`ws.transcripts_sent`** — количество отправленных транскриптов клиентам

### Frontend метрики (консоль браузера)

1. **`[CLIENT_METRICS] ⚠️ High client-side transcript latency`** — предупреждение при задержке > 2000ms на клиенте
   - **Описание:** Время от `ts` в сообщении до получения на клиенте
   - **Цель:** < 2000ms

---

## Результаты после доработок

### Метрика `stt.end_to_transcript_ms` (основная)

**До доработок:**
- Возвращала `null`
- Не записывалась

**После доработок:**
```json
{
  "count": 51,
  "avgMs": 71.6,
  "minMs": 3,
  "maxMs": 313
}
```

**Анализ:**
- ✅ **Средняя задержка: 71.6ms** — отличный результат (цель < 1500ms)
- ✅ **Минимальная задержка: 3ms** — практически мгновенно
- ⚠️ **Максимальная задержка: 313ms** — в пределах нормы, но стоит мониторить
- ✅ **Метрика записывается корректно** — больше не возвращает `null`

**Вывод:** Пайплайн работает стабильно с низкой задержкой. Максимальная задержка 313ms находится в пределах нормы для real-time транскрипции.

### Другие метрики

**`gladia.message_gap_ms`:**
- Средний gap: 64ms
- Максимальный gap: 111ms
- ✅ Стабильные промежутки между сообщениями

**`audio.chunk_size_bytes`:**
- Средний размер: 2167 bytes (~135ms аудио)
- ✅ Оптимальный размер для минимальной задержки

**`ws.broadcast_loop_ms`:**
- Средняя задержка: 0.19ms
- ✅ Практически мгновенный broadcast

**`ingest.broadcast_latency_ms`:**
- Средняя задержка: 0.2ms
- ✅ Минимальная задержка обработки

### UX улучшения

**До доработок:**
- Interim транскрипты не показывались мгновенно
- Пользователь видел текст только после финализации
- Зависшие draft сообщения создавали ощущение "подвисания"

**После доработок:**
- ✅ Interim транскрипты показываются мгновенно
- ✅ Улучшена логика обработки финальных транскриптов
- ✅ Авто-финализация убирает ощущение "подвисания"

---

## Мониторинг и алерты

### Ключевые метрики для мониторинга

1. **`stt.end_to_transcript_ms.avgMs`** — средняя задержка (цель: < 1500ms)
2. **`stt.end_to_transcript_ms.maxMs`** — максимальная задержка (цель: < 2000ms)
3. **`gladia.message_gap_ms.maxMs`** — максимальный gap (цель: < 200ms)

### Предупреждения в логах

1. **`[METRICS] ⚠️ High STT latency`** — при `stt.end_to_transcript_ms > 2000ms`
2. **`[CLIENT_METRICS] ⚠️ High client-side transcript latency`** — при задержке > 2000ms на клиенте
3. **`[GladiaBridge] ⚠️ Long gap between messages`** — при `gladia.message_gap_ms > 2000ms`

### Рекомендации по мониторингу

1. **Отслеживайте соотношение:**
   - `gladia.messages_total` / `ws.transcripts_sent` — показывает долю служебных сообщений
   - В норме: ~20-25 сообщений на 1 транскрипт (interim + final)

2. **Проверка стабильности:**
   - `audio.chunk_size_bytes` должен быть стабильным (~2000-3000 bytes)
   - Резкие скачки могут указывать на проблемы с FFmpeg

3. **Анализ джиттера:**
   - Если `stt.end_to_transcript_ms.maxMs` > 2000ms — проверьте логи на предупреждения
   - Если `gladia.message_gap_ms.maxMs` > 200ms — возможны проблемы с сетью или Gladia

---

## Выводы

### Что работает хорошо

1. ✅ **Низкая средняя задержка:** 71.6ms (цель < 1500ms)
2. ✅ **Стабильные промежутки между сообщениями:** 64ms в среднем
3. ✅ **Минимальная задержка обработки:** < 1ms для broadcast и ingest
4. ✅ **Оптимальный размер аудио чанков:** ~2167 bytes

### Что требует внимания

1. ⚠️ **Максимальная задержка:** 313ms (в пределах нормы, но стоит мониторить)
2. ⚠️ **Метрика `gladia.stt_latency_ms`:** записывается редко (только для финальных транскриптов с реальными таймингами)

### Следующие шаги

1. **Мониторинг:** Отслеживать `stt.end_to_transcript_ms.maxMs` на предмет скачков > 2000ms
2. **Оптимизация:** Если максимальная задержка регулярно превышает 500ms, стоит проверить:
   - Стабильность RTMP потока
   - Задержку сети до Gladia
   - Нагрузку на сервер
3. **Документация:** Обновить документацию по метрикам с учетом новых результатов

---

## Технические детали

### Архитектура метрик

```
FFmpeg → [audio.chunks_sent] → Gladia → [gladia.messages_total] → 
[stt.end_to_transcript_ms] → Ingest → [ingest.broadcast_latency_ms] → 
[ws.broadcast_loop_ms] → WebSocket → Client → [client latency]
```

### Формулы метрик

1. **`stt.end_to_transcript_ms`** = `now - lastAudioChunkSentAt`
2. **`gladia.stt_latency_ms`** = `receivedAt - endedAt.getTime()` (только если endedAt реальный)
3. **`ingest.processing_latency_ms`** = `now - event.receivedAt`
4. **`ws.broadcast_loop_ms`** = `broadcastEnd - broadcastStart`

### Источники данных

- **`lastAudioChunkSentAt`** — обновляется в `startFFmpegDecoder()` при каждой отправке аудио чанка
- **`event.receivedAt`** — устанавливается в `gladia-bridge.ts` при получении сообщения от Gladia
- **`event.endedAt`** — извлекается из реальных таймингов от Gladia (если есть)

---

**Дата создания:** 2025-12-03  
**Версия:** 1.0  
**Статус:** ✅ Реализовано и протестировано


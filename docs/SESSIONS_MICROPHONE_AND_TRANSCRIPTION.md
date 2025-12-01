# Сессии: Состояния микрофона и транскрипция

Детальный технический документ о том, как работают состояния микрофона и как они влияют на транскрипцию в сессиях.

---

## 1. Общая архитектура

### 1.1. Компоненты системы

```
┌─────────────────────────────────────────────────────────────┐
│                 Next.js Frontend (Client)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SessionContent (page.tsx)                            │  │
│  │  - Управление UI состояниями микрофона                │  │
│  │  - handleMicrophoneToggle()                           │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │                                      │
│  ┌────────────────────▼──────────────────────────────────┐  │
│  │  useLocalParticipantTranscription                     │  │
│  │  - Отслеживание состояния микрофона                   │  │
│  │  - Управление транскрипцией                           │  │
│  │  - AudioContext, WebSocket к транскрипционному серверу│  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │                                      │
│  ┌────────────────────▼──────────────────────────────────┐  │
│  │  LiveKit LocalParticipant                             │  │
│  │  - TrackPublication (Microphone)                      │  │
│  │  - Track (MediaStreamTrack)                           │  │
│  │  - isMuted состояние                                  │  │
│  └────────────────────┬──────────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        │ WebSocket (audio chunks)
                        │
┌───────────────────────▼──────────────────────────────────────┐
│           WebSocket Server (ws://localhost:3001)             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  handleClientConnection()                             │  │
│  │  - Принимает аудио чанки (PCM16)                     │  │
│  │  - Создает GladiaBridge для каждого клиента          │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │                                      │
│  ┌────────────────────▼──────────────────────────────────┐  │
│  │  GladiaBridge                                         │  │
│  │  - Отправляет аудио в Gladia API                     │  │
│  │  - Получает транскрипты                              │  │
│  │  - Сохраняет в БД через appendTranscriptChunk()      │  │
│  └────────────────────┬──────────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        │ HTTP/WebSocket
                        │
┌───────────────────────▼──────────────────────────────────────┐
│                    Gladia API                                │
│              (Транскрипция аудио в текст)                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Состояния микрофона

### 2.1. Уровни абстракции состояний

Микрофон имеет состояния на нескольких уровнях:

#### **Уровень 1: LiveKit TrackPublication**

```typescript
// Получаем публикацию трека микрофона
const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)

// Состояния:
- micPublication === null          // Трек еще не опубликован (микрофон не запрашивался)
- micPublication !== null          // Трек опубликован
  - micPublication.isMuted === true   // Микрофон выключен (muted)
  - micPublication.isMuted === false  // Микрофон включен (unmuted)
  - micPublication.track === null     // Трек удален (unpublished)
  - micPublication.track !== null     // Трек активен
```

**Код из `useLocalParticipantTranscription.ts`:**

```244:249:src/hooks/useLocalParticipantTranscription.ts
  // Запуск транскрипции
  useEffect(() => {
    // Проверяем состояние микрофона
    // Блокируем запуск только если трек существует И явно выключен (isMuted === true)
    // Если трека нет - разрешаем запуск (трек появится при включении микрофона)
    const micPublication = localParticipant?.getTrackPublication(Track.Source.Microphone)
    const isMicMuted = micPublication && micPublication.track && micPublication.isMuted
```

#### **Уровень 2: UI State (React)**

```typescript
// Состояние в SessionContent
const [micEnabled, setMicEnabled] = useState(false)

// Обновляется на основе реального состояния трека
```

**Код из `page.tsx`:**

```341:367:src/app/session/[slug]/page.tsx
  // Обновляем состояние кнопок на основе реального состояния треков
  useEffect(() => {
    if (!localParticipant) return

    const updateStates = () => {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
      const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera)
      const screenSharePub = localParticipant.getTrackPublication(Track.Source.ScreenShare)

      const micEnabled = micPub ? !micPub.isMuted : false
      const camEnabled = cameraPub ? !cameraPub.isMuted : false
      const screenShareEnabled = screenSharePub ? !screenSharePub.isMuted : false

      console.log('[SessionContent] Track states updated', {
        micEnabled,
        camEnabled,
        screenShareEnabled,
        cameraPub: cameraPub ? {
          trackSid: cameraPub.trackSid,
          isMuted: cameraPub.isMuted,
          hasTrack: !!cameraPub.track,
        } : null,
      })

      setMicEnabled(micEnabled)
      setCameraEnabled(camEnabled)
      setScreenShareEnabled(screenShareEnabled)
    }
```

#### **Уровень 3: MediaStreamTrack**

```typescript
// Нативный браузерный трек
const mediaStreamTrack = audioTrack.mediaStreamTrack

// Состояния:
- mediaStreamTrack.enabled === true   // Трек включен
- mediaStreamTrack.enabled === false  // Трек отключен
- mediaStreamTrack.muted === true     // Трек приглушен (аудио не доступно)
- mediaStreamTrack.muted === false    // Трек активен (аудио доступно)
```

---

### 2.2. События изменения состояния микрофона

LiveKit генерирует события при изменении состояния микрофона:

#### **События LocalParticipant:**

1. **`trackPublished`** — трек опубликован (микрофон запрошен и включен)
2. **`trackUnpublished`** — трек удален (микрофон отключен)
3. **`trackMuted`** — трек приглушен (микрофон выключен)
4. **`trackUnmuted`** — трек разглушен (микрофон включен)

**Код подписки на события из `useLocalParticipantTranscription.ts`:**

```209:241:src/hooks/useLocalParticipantTranscription.ts
    // Подписываемся на события изменения трека микрофона
    const handleTrackMuted = () => {
      console.log('[Transcription] Microphone track muted event')
      checkMicState()
    }

    const handleTrackUnmuted = () => {
      console.log('[Transcription] Microphone track unmuted event')
      // Микрофон включен - транскрипция перезапустится через основной useEffect
    }

    const handleTrackPublished = () => {
      console.log('[Transcription] Microphone track published event')
      checkMicState()
    }

    const handleTrackUnpublished = () => {
      console.log('[Transcription] Microphone track unpublished event')
      checkMicState()
    }

    localParticipant.on('trackMuted', handleTrackMuted)
    localParticipant.on('trackUnmuted', handleTrackUnmuted)
    localParticipant.on('trackPublished', handleTrackPublished)
    localParticipant.on('trackUnpublished', handleTrackUnpublished)

    return () => {
      localParticipant.off('trackMuted', handleTrackMuted)
      localParticipant.off('trackUnmuted', handleTrackUnmuted)
      localParticipant.off('trackPublished', handleTrackPublished)
      localParticipant.off('trackUnpublished', handleTrackUnpublished)
    }
```

---

### 2.3. Жизненный цикл состояния микрофона

```
1. Инициализация сессии
   ↓
2. Подключение к LiveKit комнате (room.connect())
   ↓
3. Автоматическое включение микрофона (по умолчанию)
   - localParticipant.setMicrophoneEnabled(true)
   ↓
4. LiveKit запрашивает доступ к микрофону у браузера
   - Показывается диалог разрешения
   ↓
5. Трек создается и публикуется
   - trackPublished событие
   - micPublication !== null
   - micPublication.isMuted === false
   ↓
6. Пользователь может выключить микрофон
   - handleMicrophoneToggle(false)
   - localParticipant.setMicrophoneEnabled(false)
   - trackMuted событие
   - micPublication.isMuted === true
   ↓
7. Пользователь может включить микрофон обратно
   - handleMicrophoneToggle(true)
   - localParticipant.setMicrophoneEnabled(true)
   - trackUnmuted событие
   - micPublication.isMuted === false
```

**Код автоматического включения микрофона:**

```206:248:src/app/session/[slug]/page.tsx
  // Автоматически включаем только микрофон при подключении (камера выключена по умолчанию)
  useEffect(() => {
    if (!room || !localParticipant) return

    const enableMedia = async () => {
      if (room.state === ConnectionState.Connected) {
        try {
          // Включаем только микрофон, камеру не включаем
          const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
          const isMicEnabled = micPub && !micPub.isMuted

          if (!isMicEnabled) {
            console.log('[SessionContent] Enabling microphone by default')
            await localParticipant.setMicrophoneEnabled(true)
          } else {
            console.log('[SessionContent] Microphone already enabled')
          }
        } catch (error) {
          console.error('[SessionContent] Failed to enable media:', error)
        }
      }
    }

    if (room.state === 'connected') {
      // Небольшая задержка, чтобы убедиться, что треки инициализированы
      const timer = setTimeout(() => {
        enableMedia()
      }, 500)
      return () => clearTimeout(timer)
    } else {
      // Ждем подключения
      const handleConnected = () => {
        setTimeout(() => {
          enableMedia()
        }, 500)
        room.off('connected', handleConnected)
      }
      room.on('connected', handleConnected)
      return () => {
        room.off('connected', handleConnected)
      }
    }
  }, [room, localParticipant, room?.state])
```

**Код ручного управления микрофоном:**

```274:303:src/app/session/[slug]/page.tsx
  const handleMicrophoneToggle = async (enabled: boolean) => {
    if (!localParticipant) return
    
    // Оптимистичное обновление - сразу обновляем состояние UI
    setMicEnabled(enabled)
    
    // Если микрофон выключается - немедленно останавливаем транскрипцию
    if (!enabled && isActive) {
      console.log('[SessionContent] Microphone disabled, stopping transcription immediately')
      stop()
    }
    
    try {
      await localParticipant.setMicrophoneEnabled(enabled)
      // Состояние уже обновлено оптимистично, но проверяем реальное состояние на случай ошибки
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
      if (micPub) {
        setMicEnabled(!micPub.isMuted)
      }
    } catch (error) {
      console.error('Failed to toggle microphone:', error)
      // Откатываем оптимистичное обновление при ошибке
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
      if (micPub) {
        setMicEnabled(!micPub.isMuted)
      } else {
        setMicEnabled(false)
      }
    }
  }
```

---

## 3. Влияние микрофона на транскрипцию

### 3.1. Условия запуска транскрипции

Транскрипция запускается только при выполнении всех условий:

```typescript
const shouldBeActive = isActive &&                    // Флаг isActive === true
  (connectionState === ConnectionState.Connected ||   // LiveKit подключен
   connectionState === ConnectionState.Reconnecting) && 
  !!room &&                                           // Room инстанс существует
  !!localParticipant &&                               // LocalParticipant существует
  !isMicMuted                                         // Микрофон НЕ выключен
```

**Код проверки условий:**

```265:269:src/hooks/useLocalParticipantTranscription.ts
    const shouldBeActive = isActive && 
      (connectionState === ConnectionState.Connected || connectionState === ConnectionState.Reconnecting) && 
      !!room && 
      !!localParticipant &&
      !isMicMuted // Микрофон не должен быть явно выключен (если null/undefined - разрешаем запуск)
```

**Важно:** 
- Если трека микрофона еще нет (`micPublication === null`), транскрипция **может** запуститься
- Транскрипция будет ждать появления трека (до 30 попыток = 6 секунд)
- Если трек появится позже, транскрипция начнет захватывать аудио

---

### 3.2. Остановка транскрипции при выключении микрофона

Транскрипция останавливается **моментально** при выключении микрофона в трех местах:

#### **Место 1: В SessionContent (UI уровень)**

```280:284:src/app/session/[slug]/page.tsx
    // Если микрофон выключается - немедленно останавливаем транскрипцию
    if (!enabled && isActive) {
      console.log('[SessionContent] Microphone disabled, stopping transcription immediately')
      stop()
    }
```

#### **Место 2: В useLocalParticipantTranscription (отслеживание событий)**

```183:203:src/hooks/useLocalParticipantTranscription.ts
    const checkMicState = () => {
      const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
      // Проверяем только если трек существует - если трека нет, не останавливаем транскрипцию
      // (трек может появиться позже)
      const isMicMuted = micPublication && micPublication.track && micPublication.isMuted

      // Если микрофон явно выключен (трек есть и isMuted === true), а транскрипция работает - останавливаем её
      if (isMicMuted && (wsRef.current || audioContextRef.current || workletNodeRef.current)) {
        console.log('[Transcription] Microphone muted, stopping transcription immediately', {
          hasWs: !!wsRef.current,
          hasAudioContext: !!audioContextRef.current,
          hasWorklet: !!workletNodeRef.current,
          micPublication: micPublication ? {
            hasTrack: !!micPublication.track,
            isMuted: micPublication.isMuted,
          } : null,
        })
        // Устанавливаем isActive в false, чтобы транскрипция не перезапустилась
        setIsActive(false)
        stopTranscription()
      }
    }
```

#### **Место 3: В AudioWorklet обработчике (на уровне аудио-процессора)**

```517:534:src/hooks/useLocalParticipantTranscription.ts
              // КРИТИЧНО: Проверяем, что микрофон не выключен перед обработкой аудио
              // Делаем проверку на каждом чанке для моментальной реакции
              // Проверяем только если трек существует - если трека нет, продолжаем работу
              const micPublication = localParticipant?.getTrackPublication(Track.Source.Microphone)
              const isMicMuted = micPublication && micPublication.track && micPublication.isMuted
              
              if (isMicMuted) {
                // Микрофон явно выключен (трек есть и isMuted === true) - немедленно останавливаем транскрипцию
                console.log('[Transcription] Microphone muted detected in worklet, stopping transcription immediately', {
                  hasMicPublication: !!micPublication,
                  hasTrack: micPublication ? !!micPublication.track : false,
                  isMuted: micPublication ? micPublication.isMuted : true,
                })
                // Устанавливаем isActive в false, чтобы транскрипция не перезапустилась
                setIsActive(false)
                stopTranscription()
                return
              }
```

**Почему три места?**

1. **UI уровень** — немедленная реакция на действие пользователя (оптимистичное обновление)
2. **События LiveKit** — гарантия остановки даже если UI не успел отреагировать
3. **AudioWorklet** — проверка на каждом аудио-чанке, чтобы не отправлять "тишину" в WebSocket

---

### 3.3. Процесс запуска транскрипции

#### **Шаг 1: Проверка доступности аудио трека**

```334:383:src/hooks/useLocalParticipantTranscription.ts
        // Получаем аудио трек от LiveKit
        // Ждем, пока трек будет доступен
        let audioTrack = null
        let attempts = 0
        const maxAttempts = 30 // Увеличиваем до 30 попыток (6 секунд)

        while (!audioTrack && attempts < maxAttempts) {
          // Используем правильный API LiveKit для получения микрофона
          const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
          
          // Проверяем, что микрофон не выключен
          if (micPublication && micPublication.isMuted) {
            console.warn('[Transcription] Microphone is muted, cannot start transcription')
            isStartingRef.current = false
            return
          }
          
          if (micPublication && micPublication.track) {
            audioTrack = micPublication.track
            console.log('[Transcription] Found audio track', {
              trackSid: audioTrack.sid,
              kind: audioTrack.kind,
              isMuted: micPublication.isMuted,
            })
          } else {
            // Если трек еще не опубликован, попробуем включить микрофон
            if (attempts === 5) {
              console.log('[Transcription] Microphone not found, trying to enable...')
              try {
                await localParticipant.setMicrophoneEnabled(true)
              } catch (e) {
                console.warn('[Transcription] Failed to enable microphone:', e)
              }
            }
          }
          
          if (!audioTrack) {
            await new Promise(resolve => setTimeout(resolve, 200))
            attempts++
          }
        }
```

#### **Шаг 2: Создание AudioContext**

```419:424:src/hooks/useLocalParticipantTranscription.ts
        // Создаем AudioContext с нужной sample rate для Gladia (16kHz)
        const targetSampleRate = 16000
        const audioContext = new AudioContext({
          sampleRate: targetSampleRate,
        })
        audioContextRef.current = audioContext
```

**Проблема:** Chrome может заблокировать AudioContext (autoplay policy)

**Решение:** Проверка и возобновление при пользовательском жесте

```426:454:src/hooks/useLocalParticipantTranscription.ts
        // Проверяем и возобновляем AudioContext если он suspended (Chrome autoplay policy)
        const resumeAudioContext = async () => {
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume()
              console.log('[Transcription] AudioContext resumed')
            } catch (error) {
              console.error('[Transcription] Failed to resume AudioContext:', error)
            }
          }
        }

        // Также возобновляем при пользовательском жесте (клик, тач и т.д.)
        const handleUserInteraction = () => {
          resumeAudioContext()
        }
        
        // Пытаемся возобновить сразу
        resumeAudioContext()

        // Добавляем обработчики для возобновления при пользовательском жесте
        document.addEventListener('click', handleUserInteraction, { once: true })
        document.addEventListener('touchstart', handleUserInteraction, { once: true })
        
        // Сохраняем ссылку на обработчики для cleanup
        const cleanupUserInteraction = () => {
          document.removeEventListener('click', handleUserInteraction)
          document.removeEventListener('touchstart', handleUserInteraction)
        }
```

#### **Шаг 3: Создание MediaStream и подключение к AudioContext**

```415:458:src/hooks/useLocalParticipantTranscription.ts
        // Создаем MediaStream из трека
        const mediaStream = new MediaStream([mediaStreamTrack])
        mediaStreamRef.current = mediaStream

        // Создаем AudioContext с нужной sample rate для Gladia (16kHz)
        const targetSampleRate = 16000
        const audioContext = new AudioContext({
          sampleRate: targetSampleRate,
        })
        audioContextRef.current = audioContext

        // Проверяем и возобновляем AudioContext если он suspended (Chrome autoplay policy)
        const resumeAudioContext = async () => {
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume()
              console.log('[Transcription] AudioContext resumed')
            } catch (error) {
              console.error('[Transcription] Failed to resume AudioContext:', error)
            }
          }
        }

        // Также возобновляем при пользовательском жесте (клик, тач и т.д.)
        const handleUserInteraction = () => {
          resumeAudioContext()
        }
        
        // Пытаемся возобновить сразу
        resumeAudioContext()

        // Добавляем обработчики для возобновления при пользовательском жесте
        document.addEventListener('click', handleUserInteraction, { once: true })
        document.addEventListener('touchstart', handleUserInteraction, { once: true })
        
        // Сохраняем ссылку на обработчики для cleanup
        const cleanupUserInteraction = () => {
          document.removeEventListener('click', handleUserInteraction)
          document.removeEventListener('touchstart', handleUserInteraction)
        }

        // Создаем источник из MediaStream
        const source = audioContext.createMediaStreamSource(mediaStream)
        sourceRef.current = source
```

#### **Шаг 4: Создание AudioWorkletNode для обработки аудио**

```495:554:src/hooks/useLocalParticipantTranscription.ts
        // Загружаем AudioWorklet модуль и создаем AudioWorkletNode
        try {
          // Загружаем worklet processor
          await audioContext.audioWorklet.addModule('/audio/transcription-processor.js')
          console.log('[Transcription] AudioWorklet module loaded')

          // Создаем AudioWorkletNode
          const workletNode = new AudioWorkletNode(audioContext, 'transcription-processor')
          workletNodeRef.current = workletNode

          // Подписываемся на сообщения из worklet
          workletNode.port.onmessage = (event) => {
            if (event.data?.type === 'audio-data' && event.data?.buffer) {
              // Проверяем состояние AudioContext (может быть suspended в Chrome)
              if (audioContext.state === 'suspended') {
                // Пытаемся возобновить
                audioContext.resume().catch((error) => {
                  console.error('[Transcription] Failed to resume AudioContext:', error)
                })
                return
              }

              // КРИТИЧНО: Проверяем, что микрофон не выключен перед обработкой аудио
              // Делаем проверку на каждом чанке для моментальной реакции
              // Проверяем только если трек существует - если трека нет, продолжаем работу
              const micPublication = localParticipant?.getTrackPublication(Track.Source.Microphone)
              const isMicMuted = micPublication && micPublication.track && micPublication.isMuted
              
              if (isMicMuted) {
                // Микрофон явно выключен (трек есть и isMuted === true) - немедленно останавливаем транскрипцию
                console.log('[Transcription] Microphone muted detected in worklet, stopping transcription immediately', {
                  hasMicPublication: !!micPublication,
                  hasTrack: micPublication ? !!micPublication.track : false,
                  isMuted: micPublication ? micPublication.isMuted : true,
                })
                // Устанавливаем isActive в false, чтобы транскрипция не перезапустилась
                setIsActive(false)
                stopTranscription()
                return
              }

              // Конвертируем ArrayBuffer обратно в Float32Array
              const float32Data = new Float32Array(event.data.buffer)
              
              // Конвертируем и отправляем
              convertAndSendAudio(float32Data)
            }
          }

          // Подключаем worklet к источнику и к destination (или к глушителю)
          source.connect(workletNode)
          workletNode.connect(audioContext.destination) // Можно заменить на GainNode с gain=0, если не нужно выводить звук

          console.log('[Transcription] AudioWorkletNode created and connected')
        } catch (error) {
          console.error('[Transcription] Failed to create AudioWorkletNode:', error)
          // Fallback: если AudioWorklet не поддерживается, можно вернуться к ScriptProcessorNode
          // Но для современного проекта лучше просто выбросить ошибку
          throw new Error(`AudioWorklet not supported or failed to load: ${error}`)
        }
```

**Конвертация аудио в PCM16:**

```460:493:src/hooks/useLocalParticipantTranscription.ts
        // Функция для конвертации Float32Array в Int16Array (PCM16) и отправки в WebSocket
        const convertAndSendAudio = (float32Data: Float32Array) => {
          if (!wsReadyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            if (audioChunkCountRef.current === 0) {
              console.warn('[Transcription] WebSocket not ready, skipping audio', {
                wsReady: wsReadyRef.current,
                wsState: wsRef.current?.readyState,
              })
            }
            return
          }

          // Конвертируем Float32Array в Int16Array (PCM16)
          const pcm16 = new Int16Array(float32Data.length)
          for (let i = 0; i < float32Data.length; i++) {
            // Ограничиваем значение в диапазоне [-1, 1] и конвертируем в 16-bit
            const s = Math.max(-1, Math.min(1, float32Data[i]))
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
          }

          // Отправляем аудио данные на сервер
          try {
            wsRef.current.send(pcm16.buffer)
            audioChunkCountRef.current++
            if (audioChunkCountRef.current === 1 || audioChunkCountRef.current % 100 === 0) {
              console.log('[Transcription] Audio chunk sent', {
                chunkNumber: audioChunkCountRef.current,
                bufferSize: pcm16.length,
              })
            }
          } catch (error) {
            console.error('[Transcription] Error sending audio:', error)
          }
        }
```

#### **Шаг 5: Подключение к WebSocket серверу транскрипции**

```556:577:src/hooks/useLocalParticipantTranscription.ts
        // Подключаем к WebSocket серверу с retry-логикой
        const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '3001'
        const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
        const wsUrl = `ws://${wsHost}:${wsPort}/api/realtime/transcribe?sessionSlug=${encodeURIComponent(sessionSlug)}`

        // Используем retry-функцию для подключения
        let ws: WebSocket
        try {
          ws = await connectTranscriptionWebSocket(wsUrl, {
            maxRetries: 5,
            baseDelayMs: 1000,
            timeoutMs: 10000,
          })
          wsRef.current = ws
          wsReadyRef.current = true
          console.log('[Transcription] WebSocket connected to Gladia server')
        } catch (error) {
          console.error('[Transcription] Failed to connect WebSocket after retries:', error)
          // Не пробрасываем ошибку дальше, чтобы не ломать транскрипцию
          // Пользователь может попробовать перезапустить транскрипцию вручную
          return
        }
```

---

### 3.4. Процесс остановки транскрипции

При остановке транскрипции происходит полная очистка всех ресурсов:

```118:177:src/hooks/useLocalParticipantTranscription.ts
  // Функция для остановки транскрипции (мягкая очистка)
  const stopTranscription = useCallback(() => {
    console.log('[Transcription] Stopping transcription...')
    
    // Очищаем timeout переподключения, если он есть
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current)
      wsReconnectTimeoutRef.current = null
    }
    
    // Закрываем WebSocket
    if (wsRef.current) {
      try {
        // Закрываем с кодом 1000 (нормальное закрытие), чтобы не триггерить переподключение
        wsRef.current.close(1000, 'Transcription stopped')
      } catch (e) {
        console.warn('[Transcription] Error closing WebSocket:', e)
      }
      wsRef.current = null
    }
    wsReadyRef.current = false

    // Отключаем AudioWorkletNode
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect()
        workletNodeRef.current.port.close() // Закрываем порт для сообщений
      } catch (e) {
        console.warn('[Transcription] Error disconnecting worklet node:', e)
      }
      workletNodeRef.current = null
    }

    // Отключаем источник
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (e) {
        console.warn('[Transcription] Error disconnecting source:', e)
      }
      sourceRef.current = null
    }

    // Закрываем AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close()
      } catch (e) {
        console.warn('[Transcription] Error closing AudioContext:', e)
      }
      audioContextRef.current = null
    }

    // Очищаем MediaStream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    console.log('[Transcription] Transcription stopped')
  }, [])
```

**Последовательность остановки:**

1. Останавливается отправка аудио чанков (WebSocket закрывается)
2. Отключается AudioWorkletNode (прекращается обработка аудио)
3. Отключается MediaStreamAudioSourceNode (прекращается захват аудио)
4. Закрывается AudioContext (освобождаются аудио ресурсы)
5. Останавливаются MediaStream треки (освобождается доступ к микрофону)

---

## 4. Автозапуск транскрипции

Транскрипция автоматически запускается при подключении к сессии:

```258:269:src/app/session/[slug]/page.tsx
  // Автозапуск транскрипции
  useEffect(() => {
    console.log('[SessionContent] Transcription state', {
      isActive,
      connectionState,
      hasStart: !!start,
    })
    if (!isActive && connectionState === ConnectionState.Connected) {
      console.log('[SessionContent] Starting transcription')
      start()
    }
  }, [isActive, start, connectionState])
```

**Условия автозапуска:**
- `isActive === false` (транскрипция еще не запущена)
- `connectionState === ConnectionState.Connected` (LiveKit комнате подключена)

**Важно:** Если микрофон выключен, транскрипция не запустится, даже если `start()` вызван. Это контролируется условием `!isMicMuted` в основном `useEffect` транскрипции.

---

## 5. Состояния транскрипции и микрофона - полная матрица

| Состояние микрофона | isActive | Транскрипция | Описание |
|---------------------|----------|--------------|----------|
| Трека нет (`micPublication === null`) | `false` | Не запущена | Микрофон еще не запрашивался |
| Трека нет (`micPublication === null`) | `true` | Ждет трек (до 6 сек) | Транскрипция запущена, но ждет появления трека |
| Трек есть, `isMuted === false` | `true` | Работает | Микрофон включен, транскрипция активна |
| Трек есть, `isMuted === false` | `false` | Не запущена | Транскрипция выключена вручную |
| Трек есть, `isMuted === true` | `true` | Останавливается | Микрофон выключен, транскрипция немедленно останавливается |
| Трек есть, `isMuted === true` | `false` | Не запущена | Микрофон выключен, транскрипция не запустится |
| Room disconnected | любое | Останавливается | При отключении от комнаты транскрипция останавливается |

---

## 6. Поток данных при работе транскрипции

```
┌──────────────────────────────────────────────────────────────┐
│  Микрофон (браузер)                                          │
│  - MediaStreamTrack (raw audio)                              │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ MediaStream
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  AudioContext (16kHz sample rate)                            │
│  - MediaStreamAudioSourceNode                                │
│  - AudioWorkletNode (transcription-processor.js)             │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ Float32Array (processed audio)
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Конвертация в PCM16                                         │
│  - Float32Array → Int16Array                                 │
│  - Sample rate: 16kHz, 16-bit, mono                         │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ ArrayBuffer (PCM16)
                    │ WebSocket.send()
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  WebSocket Server (ws://localhost:3001)                      │
│  - Принимает аудио чанки                                     │
│  - Передает в GladiaBridge                                   │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ ArrayBuffer (PCM16)
                    │ WebSocket.send()
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  GladiaBridge                                                │
│  - WebSocket к Gladia API                                    │
│  - Отправляет аудио в Gladia                                 │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ HTTP POST /v2/live → WebSocket URL
                    │ WebSocket к Gladia
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Gladia API                                                  │
│  - Транскрипция аудио в текст                                │
│  - Возвращает транскрипты (partial и final)                  │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ JSON: { type: 'transcript', text: '...', is_final: true/false }
                    │ WebSocket message
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  GladiaBridge                                                │
│  - Получает транскрипты от Gladia                            │
│  - Сохраняет в БД через appendTranscriptChunk()              │
│  - Отправляет транскрипты клиенту                            │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ JSON: { type: 'transcription', text: '...', is_final: true/false }
                    │ WebSocket.send()
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Клиент (useLocalParticipantTranscription)                   │
│  - Получает транскрипты от WebSocket сервера                 │
│  - Публикует в LiveKit через publishData()                   │
│  - Вызывает локальный callback (onTranscriptCallbackRef)      │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    │ LiveKit DataChannel
                    │ + Локальный callback
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Все участники сессии                                        │
│  - Получают транскрипты через dataReceived event             │
│  - Отображают в TranscriptSidebar                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Критические моменты и особенности

### 7.1. Множественные проверки состояния микрофона

Проверка состояния микрофона происходит в трех местах для гарантии моментальной остановки:

1. **UI уровень** — при нажатии кнопки выключения микрофона
2. **Уровень событий LiveKit** — при получении `trackMuted` события
3. **Уровень аудио-процессора** — на каждом аудио-чанке перед отправкой

Это гарантирует, что транскрипция остановится даже если:
- Пользователь быстро выключил/включил микрофон
- LiveKit события пришли с задержкой
- Аудио-чанки уже были обработаны, но еще не отправлены

### 7.2. Ожидание трека микрофона

Если микрофон еще не запрошен (`micPublication === null`), транскрипция все равно может запуститься и будет ждать появления трека:

```334:373:src/hooks/useLocalParticipantTranscription.ts
        // Получаем аудио трек от LiveKit
        // Ждем, пока трек будет доступен
        let audioTrack = null
        let attempts = 0
        const maxAttempts = 30 // Увеличиваем до 30 попыток (6 секунд)

        while (!audioTrack && attempts < maxAttempts) {
          // Используем правильный API LiveKit для получения микрофона
          const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
          
          // Проверяем, что микрофон не выключен
          if (micPublication && micPublication.isMuted) {
            console.warn('[Transcription] Microphone is muted, cannot start transcription')
            isStartingRef.current = false
            return
          }
          
          if (micPublication && micPublication.track) {
            audioTrack = micPublication.track
            console.log('[Transcription] Found audio track', {
              trackSid: audioTrack.sid,
              kind: audioTrack.kind,
              isMuted: micPublication.isMuted,
            })
          } else {
            // Если трек еще не опубликован, попробуем включить микрофон
            if (attempts === 5) {
              console.log('[Transcription] Microphone not found, trying to enable...')
              try {
                await localParticipant.setMicrophoneEnabled(true)
              } catch (e) {
                console.warn('[Transcription] Failed to enable microphone:', e)
              }
            }
          }
          
          if (!audioTrack) {
            await new Promise(resolve => setTimeout(resolve, 200))
            attempts++
          }
        }
```

**Поведение:**
- Транскрипция ждет до 30 попыток (6 секунд)
- На 5-й попытке автоматически пытается включить микрофон
- Если трек так и не появился — транскрипция не запускается

### 7.3. Chrome Autoplay Policy

Chrome блокирует автоматический запуск AudioContext без пользовательского жеста. Решение:

```426:454:src/hooks/useLocalParticipantTranscription.ts
        // Проверяем и возобновляем AudioContext если он suspended (Chrome autoplay policy)
        const resumeAudioContext = async () => {
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume()
              console.log('[Transcription] AudioContext resumed')
            } catch (error) {
              console.error('[Transcription] Failed to resume AudioContext:', error)
            }
          }
        }

        // Также возобновляем при пользовательском жесте (клик, тач и т.д.)
        const handleUserInteraction = () => {
          resumeAudioContext()
        }
        
        // Пытаемся возобновить сразу
        resumeAudioContext()

        // Добавляем обработчики для возобновления при пользовательском жесте
        document.addEventListener('click', handleUserInteraction, { once: true })
        document.addEventListener('touchstart', handleUserInteraction, { once: true })
        
        // Сохраняем ссылку на обработчики для cleanup
        const cleanupUserInteraction = () => {
          document.removeEventListener('click', handleUserInteraction)
          document.removeEventListener('touchstart', handleUserInteraction)
        }
```

**Также проверка в AudioWorklet обработчике:**

```508:515:src/hooks/useLocalParticipantTranscription.ts
              // Проверяем состояние AudioContext (может быть suspended в Chrome)
              if (audioContext.state === 'suspended') {
                // Пытаемся возобновить
                audioContext.resume().catch((error) => {
                  console.error('[Transcription] Failed to resume AudioContext:', error)
                })
                return
              }
```

### 7.4. Переподключение LiveKit

При переподключении LiveKit (`ConnectionState.Reconnecting` → `ConnectionState.Connected`) транскрипция может продолжить работу, если WebSocket и AudioContext еще активны:

```288:300:src/hooks/useLocalParticipantTranscription.ts
    // Если состояние Reconnecting, но транскрипция уже запущена - продолжаем работу
    // WebSocket может продолжать работать даже при временных проблемах с LiveKit
    // НО только если микрофон включен
    if (connectionState === ConnectionState.Reconnecting) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && audioContextRef.current && !isMicMuted) {
        console.log('[Transcription] Room reconnecting, but transcription continues', {
          wsState: wsRef.current.readyState,
          hasAudioContext: !!audioContextRef.current,
          isMicMuted,
        })
        // Не останавливаем транскрипцию - она может продолжать работать
        return
      }
    }
```

**Важно:** Транскрипция продолжает работать при `Reconnecting`, но проверяет, что микрофон включен.

### 7.5. WebSocket переподключение

Если WebSocket соединение разорвалось, автоматически пытается переподключиться:

```612:669:src/hooks/useLocalParticipantTranscription.ts
        // Функция для переподключения WebSocket
        const reconnectWebSocket = async () => {
          if (!isMountedRef.current || !isActive) {
            return
          }

          // Проверяем, что комната всё ещё подключена
          if (!room || room.state !== ConnectionState.Connected || !localParticipant) {
            console.log('[Transcription] Room not connected, skipping WebSocket reconnect')
            return
          }

          console.log('[Transcription] Attempting to reconnect WebSocket...')
          
          try {
            const newWs = await connectTranscriptionWebSocket(wsUrl, {
              maxRetries: 3, // Меньше попыток при переподключении
              baseDelayMs: 500,
              timeoutMs: 5000,
            })
            wsRef.current = newWs
            wsReadyRef.current = true
            console.log('[Transcription] WebSocket reconnected successfully')

            // Настраиваем обработчики для нового WebSocket
            newWs.onmessage = handleMessage
            newWs.onerror = (error) => {
              console.error('[Transcription] Reconnected WebSocket error:', error)
              wsReadyRef.current = false
            }
            newWs.onclose = (event) => {
              wsReadyRef.current = false
              console.log('[Transcription] Reconnected WebSocket closed', {
                code: event.code,
                reason: event.reason,
              })
              
              // Если закрылось не по нашей инициативе (код 1000) и транскрипция активна, переподключаемся
              if (event.code !== 1000 && isActive && room && room.state === ConnectionState.Connected && localParticipant && isMountedRef.current) {
                // Очищаем предыдущий timeout
                if (wsReconnectTimeoutRef.current) {
                  clearTimeout(wsReconnectTimeoutRef.current)
                }
                // Пытаемся переподключиться снова
                wsReconnectTimeoutRef.current = setTimeout(reconnectWebSocket, 1000)
              }
            }
          } catch (error) {
            console.error('[Transcription] Failed to reconnect WebSocket:', error)
            // Если не удалось переподключиться, но транскрипция активна, пробуем еще раз
            if (isActive && room && room.state === ConnectionState.Connected && localParticipant && isMountedRef.current) {
              if (wsReconnectTimeoutRef.current) {
                clearTimeout(wsReconnectTimeoutRef.current)
              }
              wsReconnectTimeoutRef.current = setTimeout(reconnectWebSocket, 2000) // Увеличиваем задержку
            }
          }
        }
```

**Условия переподключения:**
- WebSocket закрыт не по нашей инициативе (код !== 1000)
- Транскрипция активна (`isActive === true`)
- Комната подключена (`room.state === ConnectionState.Connected`)
- Микрофон включен (проверяется через `isMicMuted`)

---

## 8. WebSocket сервер транскрипции

### 8.1. Обработка клиентских соединений

```12:101:ws/server/client-connection.ts
export function handleClientConnection({ ws, req }: ClientConnectionOptions): void {
  console.log('[WS-SERVER] Client connected', {
    remoteAddress: req.socket.remoteAddress,
  })

  // Парсим sessionSlug и participantIdentity из query или headers
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const sessionSlug = url.searchParams.get('sessionSlug') || url.searchParams.get('session')
  const participantIdentity = url.searchParams.get('identity') || url.searchParams.get('participant')

  if (!sessionSlug) {
    console.error('[WS-SERVER] Missing sessionSlug in query')
    ws.close(1008, 'Missing sessionSlug')
    return
  }

  let gladiaBridge: Awaited<ReturnType<typeof createGladiaBridge>> | null = null
  let isGladiaReady = false

  // Инициализируем Gladia bridge
  createGladiaBridge()
    .then((bridge) => {
      gladiaBridge = bridge
      isGladiaReady = true

      // Подписываемся на транскрипты от Gladia
      bridge.onTranscript(async (event: TranscriptEvent) => {
        try {
          // Сохраняем транскрипт в БД
          await appendTranscriptChunk({
            sessionSlug,
            participantIdentity: participantIdentity || undefined,
            utteranceId: event.utteranceId,
            text: event.text,
            isFinal: event.isFinal,
            startedAt: event.startedAt,
            endedAt: event.endedAt,
          })

          // Отправляем транскрипт клиенту
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'transcription',
              text: event.text,
              is_final: event.isFinal,
              utterance_id: event.utteranceId,
            }))
          }
        } catch (error) {
          console.error('[WS-SERVER] Error processing transcript:', error)
        }
      })
    })
    .catch((error) => {
      console.error('[WS-SERVER] Failed to create Gladia bridge:', error)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to initialize transcription',
        }))
        ws.close()
      }
    })

  // Обрабатываем аудио чанки от клиента
  ws.on('message', (data: WebSocket.Data) => {
    if (!isGladiaReady || !gladiaBridge) {
      return
    }

    // Отправляем аудио в Gladia
    if (data instanceof Buffer || data instanceof ArrayBuffer) {
      gladiaBridge.sendAudio(data)
    }
  })

  ws.on('close', () => {
    console.log('[WS-SERVER] Client disconnected')
    if (gladiaBridge) {
      gladiaBridge.close()
    }
  })

  ws.on('error', (error) => {
    console.error('[WS-SERVER] Client WebSocket error:', error)
    if (gladiaBridge) {
      gladiaBridge.close()
    }
  })
}
```

**Особенности:**
- Каждое клиентское соединение создает свой `GladiaBridge`
- Аудио чанки (PCM16) пересылаются напрямую в Gladia
- Транскрипты сохраняются в БД и отправляются клиенту
- При закрытии соединения `GladiaBridge` закрывается

### 8.2. GladiaBridge

```29:99:ws/server/gladia-bridge.ts
export async function createGladiaBridge(): Promise<GladiaBridge> {
  const apiKey = getGladiaApiKey()
  
  // Инициализация сессии через POST /v2/live
  const websocketUrl = await initGladiaSession(apiKey)
  
  // Подключение к WebSocket
  const gladiaWs = new WebSocket(websocketUrl)
  
  let transcriptCallback: ((event: TranscriptEvent) => void) | null = null
  let isReady = false
  
  gladiaWs.on('open', () => {
    console.log('[GladiaBridge] WebSocket connected')
    isReady = true
  })
  
  gladiaWs.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString())
      
      // Обрабатываем транскрипты
      if (message.type === 'transcript' && message.data) {
        const transcriptData = message.data
        
        if (transcriptData.utterance && transcriptData.utterance.text) {
          const text = transcriptData.utterance.text.trim()
          const isFinal = transcriptData.is_final === true
          const utteranceId = transcriptData.id || null
          
          if (text && utteranceId && transcriptCallback) {
            transcriptCallback({
              utteranceId,
              text,
              isFinal,
              startedAt: new Date(),
              endedAt: isFinal ? new Date() : undefined,
            })
          }
        }
      }
    } catch (error) {
      console.error('[GladiaBridge] Error parsing message:', error)
    }
  })
  
  gladiaWs.on('error', (error) => {
    console.error('[GladiaBridge] WebSocket error:', error)
  })
  
  gladiaWs.on('close', () => {
    console.log('[GladiaBridge] WebSocket closed')
    isReady = false
  })
  
  return {
    sendAudio(chunk: ArrayBuffer | Buffer) {
      if (isReady && gladiaWs.readyState === WebSocket.OPEN) {
        gladiaWs.send(chunk)
      }
    },
    close() {
      if (gladiaWs.readyState === WebSocket.OPEN) {
        gladiaWs.close()
      }
    },
    onTranscript(cb: (event: TranscriptEvent) => void) {
      transcriptCallback = cb
    },
  }
}
```

**Инициализация сессии Gladia:**

```101:157:ws/server/gladia-bridge.ts
async function initGladiaSession(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      messages_config: {
        receive_partial_transcripts: true,
      },
    })
    
    const options = {
      hostname: 'api.gladia.io',
      path: '/v2/live',
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 201 && res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          return
        }
        
        try {
          const response = JSON.parse(data)
          const websocketUrl = response.url || response.websocket_url
          
          if (websocketUrl) {
            resolve(websocketUrl)
          } else {
            reject(new Error('No websocket_url in response'))
          }
        } catch (error) {
          reject(error)
        }
      })
    })
    
    req.on('error', (error) => {
      reject(error)
    })
    
    req.write(postData)
    req.end()
  })
}
```

**Настройки аудио для Gladia:**
- Format: `wav/pcm`
- Sample rate: `16000 Hz`
- Bit depth: `16-bit`
- Channels: `1` (mono)
- Partial transcripts: `true` (получаем промежуточные и финальные транскрипты)

---

## 9. Резюме

### Ключевые моменты:

1. **Состояние микрофона контролирует транскрипцию** — если микрофон выключен (`isMuted === true`), транскрипция не запускается или останавливается немедленно.

2. **Три уровня проверки состояния** — UI, события LiveKit, и аудио-процессор гарантируют моментальную остановку.

3. **Ожидание трека** — если трек еще не опубликован, транскрипция может запуститься и будет ждать до 6 секунд.

4. **Chrome Autoplay Policy** — AudioContext может быть заблокирован и требует пользовательского жеста для возобновления.

5. **WebSocket переподключение** — автоматическое переподключение при разрыве соединения, если транскрипция активна и микрофон включен.

6. **Переподключение LiveKit** — транскрипция может продолжать работать при временных проблемах с LiveKit, если WebSocket и AudioContext активны.

7. **Полная очистка ресурсов** — при остановке транскрипции закрываются все ресурсы: WebSocket, AudioContext, MediaStream треки.

### Поток данных:

```
Микрофон → MediaStream → AudioContext → AudioWorkletNode → PCM16 → 
WebSocket → WebSocket Server → GladiaBridge → Gladia API → 
Транскрипты → WebSocket Server → Клиент → LiveKit DataChannel → 
Все участники
```

---

**Документ обновлен:** `2024-12-XX`  
**Версия:** `1.0`


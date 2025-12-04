'use client'

import { useEffect, useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Room, Track, ConnectionState, RoomEvent, LocalParticipant, RemoteParticipant, createLocalScreenTracks } from 'livekit-client'
import { TranscriptSidebar } from '@/components/session/TranscriptSidebar'
import { TranscriptProvider, useTranscriptContext } from '@/contexts/TranscriptContext'
import { useLocalParticipantTranscription } from '@/hooks/useLocalParticipantTranscription'
import { useActiveSpeakerTracker } from '@/hooks/useActiveSpeakerTracker'
import { useRoom } from '@/hooks/useRoom'
import { useParticipants } from '@/hooks/useParticipants'
import { useMediaControls } from '@/hooks/useMediaControls'
import { VideoGrid } from '@/shared/ui/video-grid'
import { ControlBar } from '@/shared/ui/control-bar'
import { GuestJoinGate } from '@/shared/ui/guest-join-gate/GuestJoinGate'
import { Button } from '@/shared/ui/button'
import { cn } from '@/lib/utils'
import { useSessionAiEngine } from '@/hooks/useSessionAiEngine'
import type { AiSessionInsights } from '@/modules/core/intelligence/domain/intelligence.types'
import { CurrentTopicBubble } from '@/shared/ui/session-ai/current-topic-bubble/CurrentTopicBubble'

interface TokenResponse {
  token: string
  roomName: string
  identity: string
  serverUrl: string
  transcriptionToken?: string // JWT токен для авторизации WebSocket транскрипции
  sessionCreatedByUserId?: string | null // ID создателя сессии (для определения designated host)
}

interface ParticipantJoinResponse {
  id: string
  sessionId: string
  identity: string
  name: string | null
  role: 'HOST' | 'GUEST'
  joinedAt: string
}

interface SessionPageClientProps {
  sessionSlug: string
  initialAiInsights: AiSessionInsights | null
}

export function SessionPageClient({ sessionSlug, initialAiInsights }: SessionPageClientProps) {
  const router = useRouter()
  const { data: session, status } = useSession()
  const slug = sessionSlug
  const [data, setData] = useState<TokenResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guest, setGuest] = useState<{ identity: string; displayName: string } | null>(null)
  const fetchTokenRef = useRef<Promise<void> | null>(null) // Защита от повторных вызовов
  const hasFetchedRef = useRef(false) // Флаг, что токен уже был запрошен

  const isAuthenticated = !!session?.user

  // Используем displayName из сессии пользователя или гостя
  useEffect(() => {
    if (!slug) {
      setError('Invalid session slug')
      return
    }

    // Ждем загрузки сессии
    if (status === 'loading') {
      return
    }

    // Если токен уже получен - не запрашиваем снова
    if (data || hasFetchedRef.current) {
      return
    }

    // Если не авторизован и нет guest данных - показываем GuestJoinGate (через return ниже)
    if (status === 'unauthenticated' && !guest) {
      return
    }

    // Если авторизован
    if (isAuthenticated) {
      const userDisplayName = session?.user?.displayName || ''

      if (!userDisplayName) {
        setError('Display name is required. Please complete onboarding first.')
        return
      }

      // Защита от повторных вызовов: если уже идет запрос - пропускаем
      if (!fetchTokenRef.current) {
        hasFetchedRef.current = true
        fetchTokenRef.current = fetchToken(userDisplayName).finally(() => {
          fetchTokenRef.current = null
        })
      }
      return
    }

    // Если гость
    if (guest) {
      if (!fetchTokenRef.current) {
        hasFetchedRef.current = true
        fetchTokenRef.current = fetchToken(guest.displayName, guest.identity).finally(() => {
          fetchTokenRef.current = null
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, session?.user?.displayName, status, guest, isAuthenticated])

  const fetchToken = async (name: string, identity?: string) => {
    if (!name.trim()) {
      return
    }

    try {
      const url = new URL(`/api/sessions/${slug}/token`, window.location.origin)
      url.searchParams.set('name', name.trim())
      if (identity) {
        url.searchParams.set('identity', identity)
      }

      const res = await fetch(url.toString())
      if (!res.ok) {
        if (res.status === 404) {
          setError('Session not found')
          return
        }
        if (res.status === 403) {
          setError('This session has ended')
          return
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After')
          const errorMsg = retryAfter 
            ? `Too many requests. Please wait ${Math.ceil(Number(retryAfter))} seconds and refresh the page.`
            : 'Too many requests. Please wait a moment and refresh the page.'
          setError(errorMsg)
          return
        }
        const errorData = await res.json().catch(() => ({}))
        setError(errorData.error || 'Failed to get session token')
        return
      }

      const tokenData = (await res.json()) as TokenResponse
      setData(tokenData)
    } catch (err) {
      console.error('[SessionPage] Failed to fetch token:', err)
      setError('Failed to connect to session')
    }
  }

  const handleGuestJoined = (guestData: { identity: string; displayName: string }) => {
    setGuest(guestData)
  }

  // Показываем GuestJoinGate если не авторизован и нет guest данных
  if (!isAuthenticated && !guest && status !== 'loading') {
    return <GuestJoinGate sessionSlug={slug} onJoined={handleGuestJoined} />
  }

  // Показываем загрузку, пока сессия загружается
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <p className="text-sm text-white-700">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <div className="flex flex-col items-center gap-4">
          <p className="text-white-700">{error}</p>
          <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8">
            <Button onClick={() => router.push('/sessions')} variant="primary" size="lg">
              back to sessions
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <p className="text-white-700">Connecting...</p>
      </div>
    )
  }

  return (
    <div className="w-full h-screen bg-surface-900 text-white-900">
      <SessionContent 
        sessionSlug={slug} 
        router={router}
        token={data.token}
        serverUrl={data.serverUrl}
        identity={data.identity}
        displayName={isAuthenticated ? (session?.user?.displayName || '') : (guest?.displayName || '')}
        transcriptionToken={data.transcriptionToken}
        sessionCreatedByUserId={data.sessionCreatedByUserId}
        currentUserId={session?.user?.id}
        initialAiInsights={initialAiInsights}
      />
    </div>
  )
}

function SessionContent({ 
  sessionSlug, 
  router,
  token,
  serverUrl,
  identity,
  displayName,
  transcriptionToken,
  sessionCreatedByUserId,
  currentUserId,
  initialAiInsights,
}: { 
  sessionSlug: string
  router: ReturnType<typeof useRouter>
  token: string
  serverUrl: string
  identity: string
  displayName: string
  transcriptionToken?: string
  sessionCreatedByUserId?: string | null
  currentUserId?: string
  initialAiInsights?: AiSessionInsights | null
}) {
  
  useEffect(() => {
    if (initialAiInsights) {
      console.log('[SessionContent] Received initialAiInsights (from server):', {
        aiTitle: initialAiInsights.aiTitle,
        currentTopic: initialAiInsights.currentTopic,
        topicsCount: initialAiInsights.topics.length,
      })
    }
  }, [initialAiInsights])
  const { room, isConnected, connectionState } = useRoom(token, serverUrl)
  const { localParticipant, remoteParticipants } = useParticipants(room)
  
  // Используем общий хук для управления медиа
  const mediaControls = useMediaControls({ localParticipant })
  const participantJoinedRef = useRef(false) // Флаг, чтобы вызвать join только один раз
  
  // Обертываем контент в TranscriptProvider для изоляции транскрипции
  return (
    <TranscriptProvider sessionSlug={sessionSlug} room={room}>
      <SessionContentInner
        sessionSlug={sessionSlug}
        router={router}
        room={room}
        isConnected={isConnected}
        connectionState={connectionState}
        localParticipant={localParticipant}
        remoteParticipants={remoteParticipants}
        mediaControls={mediaControls}
        participantJoinedRef={participantJoinedRef}
        transcriptionToken={transcriptionToken}
        sessionCreatedByUserId={sessionCreatedByUserId}
        currentUserId={currentUserId}
        identity={identity}
        displayName={displayName}
        initialAiInsights={initialAiInsights}
      />
    </TranscriptProvider>
  )
}

function SessionContentInner({
  sessionSlug,
  router,
  room,
  isConnected,
  connectionState,
  localParticipant,
  remoteParticipants,
  mediaControls,
  participantJoinedRef,
  transcriptionToken,
  sessionCreatedByUserId,
  currentUserId,
  identity,
  displayName,
  initialAiInsights,
}: {
  sessionSlug: string
  router: ReturnType<typeof useRouter>
  room: Room | null
  isConnected: boolean
  connectionState: ConnectionState
  localParticipant: LocalParticipant | null
  remoteParticipants: RemoteParticipant[]
  mediaControls: ReturnType<typeof useMediaControls>
  participantJoinedRef: React.MutableRefObject<boolean>
  transcriptionToken?: string
  sessionCreatedByUserId?: string | null
  currentUserId?: string
  identity: string
  displayName: string
  initialAiInsights?: AiSessionInsights | null
}) {
  const [isPending, startTransition] = useTransition()
  // Используем контекст транскрипции
  const { transcripts, addMessage } = useTranscriptContext()
  
  // STT readiness: отслеживаем первый partial transcript
  // Начинаем с false, если есть transcriptionToken (значит транскрипция должна работать)
  const [sttReady, setSttReady] = useState(!transcriptionToken)

  // AI Session Engine - получаем initialInsights из пропсов (гидрация из БД через серверный рендер)
  // topics[] is the single source of truth for both CurrentTopicBubble and TopicToastStack
  const { aiTitle, currentTopicLabel, topics } = useSessionAiEngine({
    sessionSlug,
    transcripts,
    initialInsights: initialAiInsights ?? null,
  })

  // Display title: AI title or session title or default session slug
  const displayTitle = aiTitle ?? `Session ${sessionSlug}`

  // Debug logging
  useEffect(() => {
    const finalTranscripts = transcripts.filter(t => t.isFinal)
    const lastTopicLabel = topics.length > 0 ? topics[topics.length - 1].label : null
    const isSynced = currentTopicLabel === lastTopicLabel
    
    console.log('[SessionContent] AI Engine state:', {
      aiTitle,
      currentTopicLabel,
      topicsCount: topics.length,
      topics: topics.map(t => t.label),
      lastTopicLabel,
      isSynced,
      transcriptsCount: transcripts.length,
      finalTranscriptsCount: finalTranscripts.length,
      displayTitle,
    })
    
    // Warn if not synced (should never happen with our invariant)
    if (!isSynced && topics.length > 0) {
      console.warn('[SessionContent] ⚠️ SYNC ISSUE: currentTopicLabel !== lastTopicLabel', {
        currentTopicLabel,
        lastTopicLabel,
        topics: topics.map(t => t.label),
      })
    }
  }, [aiTitle, currentTopicLabel, topics, transcripts, displayTitle])

  // Создание участника в БД при подключении к комнате
  useEffect(() => {
    if (!room || !isConnected || connectionState !== ConnectionState.Connected || participantJoinedRef.current) {
      return
    }

    const joinParticipant = async () => {
      try {
        participantJoinedRef.current = true
        console.log('[SessionContent] Joining participant to session', { identity, displayName })
        
        const res = await fetch(`/api/sessions/${sessionSlug}/participants/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity,
            name: displayName || undefined,
            // Если currentUserId отсутствует, это гость
            role: currentUserId ? undefined : 'GUEST',
            isGuest: !currentUserId,
          }),
        })

        if (!res.ok) {
          console.error('[SessionContent] Failed to join participant', res.status)
          return
        }

        const participantData = (await res.json()) as ParticipantJoinResponse
        console.log('[SessionContent] Participant joined', participantData)
      } catch (error) {
        console.error('[SessionContent] Error joining participant', error)
      }
    }

    joinParticipant()
  }, [room, isConnected, connectionState, identity, displayName, sessionSlug, currentUserId])

  // Автоматическое включение микрофона при подключении к комнате
  useEffect(() => {
    if (!localParticipant || !isConnected || connectionState !== ConnectionState.Connected) {
      return
    }

    // Включаем микрофон автоматически при подключении
    const enableMic = async () => {
      try {
        const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
        if (!micPublication || !micPublication.track) {
          console.log('[SessionContent] Enabling microphone on connect...')
          await localParticipant.setMicrophoneEnabled(true)
          mediaControls.setMicEnabled(true)
        } else {
          // Если трек уже есть, проверяем его состояние
          if (micPublication.isMuted) {
            console.log('[SessionContent] Microphone track exists but is muted, enabling...')
            await localParticipant.setMicrophoneEnabled(true)
            mediaControls.setMicEnabled(true)
          } else {
            mediaControls.setMicEnabled(true)
          }
        }
      } catch (error) {
        console.error('[SessionContent] Failed to enable microphone on connect:', error)
      }
    }

    enableMic()
  }, [localParticipant, isConnected, connectionState, mediaControls])

  // Подключение транскрипции для локального участника
  const transcription = useLocalParticipantTranscription({
    room,
    localParticipant,
    sessionSlug,
    connectionState,
    transcriptionToken,
  })

  // Устанавливаем callback для транскриптов и запускаем транскрипцию
  useEffect(() => {
    // Wrapper для addMessage, который также отслеживает stt_status и первый partial (fallback)
    const wrappedAddMessage = (message: any) => {
      // Обрабатываем stt_status: ready - основной способ определения готовности
      if (message.type === 'stt_status' && message.status === 'ready') {
        console.log('[SessionContent] STT ready: stt_status: ready received')
        setSttReady(true)
        // stt_status не является транскриптом, не передаем в addMessage
        return
      }
      
      // Fallback: если stt_status не пришел, но пришел первый partial - считаем готовым
      if (!sttReady && !message.isFinal && (message.type === 'transcript_partial' || message.type === 'transcript')) {
        console.log('[SessionContent] STT ready: first partial transcript received (fallback)')
        setSttReady(true)
      }
      
      // Передаем только транскрипты в addMessage
      addMessage(message)
    }
    
    transcription.setOnTranscriptCallback(wrappedAddMessage)
    // Запускаем транскрипцию автоматически при подключении
    if (isConnected && connectionState === ConnectionState.Connected) {
      transcription.start()
    }
    return () => {
      transcription.setOnTranscriptCallback(null)
      transcription.stop()
    }
  }, [transcription, addMessage, isConnected, connectionState, sttReady])
  
  // Сбрасываем sttReady при отключении или смене сессии
  useEffect(() => {
    if (!isConnected || connectionState !== ConnectionState.Connected) {
      setSttReady(!transcriptionToken) // Сбрасываем только если есть transcriptionToken
    }
  }, [isConnected, connectionState, transcriptionToken])

  // Отслеживание активного спикера
  useActiveSpeakerTracker({
    room,
    localParticipant,
    remoteParticipants,
    sessionSlug,
    transcriptionToken,
  })

  // Обработчики медиа-контролов
  const handleMicrophoneToggle = async () => {
    if (!localParticipant) return
    // Используем правильный API LiveKit для переключения микрофона
    const newState = !mediaControls.micEnabled
    await mediaControls.toggleMicrophone(newState)
  }

  const handleCameraToggle = async () => {
    if (!localParticipant) return
    // Используем правильный API LiveKit для переключения камеры
    const newState = !mediaControls.cameraEnabled
    await mediaControls.toggleCamera(newState)
  }

  const handleScreenShareToggle = async () => {
    if (!localParticipant) return
    
    if (mediaControls.screenShareEnabled) {
      // Остановить screen share
      const screenTrack = localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track
      if (screenTrack) {
        await localParticipant.unpublishTrack(screenTrack)
        screenTrack.stop()
      }
      mediaControls.setScreenShareEnabled(false)
    } else {
      // Начать screen share
      try {
        const screenTracks = await createLocalScreenTracks({
          video: true,
          audio: true,
        })
        if (screenTracks && screenTracks.length > 0) {
          await localParticipant.publishTrack(screenTracks[0], { source: Track.Source.ScreenShare })
          mediaControls.setScreenShareEnabled(true)
        }
      } catch (error) {
        console.error('[SessionContent] Failed to start screen share', error)
      }
    }
  }

  const handleLeave = () => {
    // 1️⃣ Мгновенный визуальный выход
    router.replace('/sessions')
    
    // 2️⃣ Мягкий disconnect LiveKit — без await
    try {
      room?.disconnect?.()
    } catch (error) {
      console.error('[SessionContent] LiveKit disconnect error', error)
    }
    
    // Cleanup уже произойдет через useEffect cleanup в useRoom
    // Но вызываем disconnect сразу для быстрого отключения
  }

  const handleEndForEveryone = () => {
    if (!sessionSlug) return
    
    // 1️⃣ Мгновенный визуальный выход
    router.replace('/sessions')
    
    // 2️⃣ Мягкий disconnect LiveKit — без await
    try {
      room?.disconnect?.()
    } catch (error) {
      console.error('[SessionContent] LiveKit disconnect error', error)
    }
    
    // 3️⃣ Серверная логика — в фоне (fire-and-forget)
    startTransition(() => {
      import('./actions').then(({ endSessionAction }) => {
        endSessionAction(sessionSlug).catch((error) => {
          console.error('[SessionContent] endSessionAction error', error)
          // Не показываем alert - пользователь уже вышел из комнаты
          // Опционально: можно показать toast, но не блокировать UI
        })
      })
    })
  }

  const isCreator = currentUserId === sessionCreatedByUserId

  // Обработка событий комнаты
  useEffect(() => {
    if (!room) return

    const handleDisconnected = () => {
      console.log('[SessionContent] Room disconnected')
      router.push('/sessions')
    }

    const handleParticipantConnected = (participant: RemoteParticipant) => {
      console.log('[SessionContent] Participant connected', participant.identity)
    }

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      console.log('[SessionContent] Participant disconnected', participant.identity)
    }

    room.on(RoomEvent.Disconnected, handleDisconnected)
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)

    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected)
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    }
  }, [room, router])

  // Обработка медиа-треков
  useEffect(() => {
    if (!localParticipant) return

    const handleTrackMuted = (publication: any) => {
      if (publication.source === Track.Source.Microphone) {
        mediaControls.setMicEnabled(false)
      } else if (publication.source === Track.Source.Camera) {
        mediaControls.setCameraEnabled(false)
      }
    }

    const handleTrackUnmuted = (publication: any) => {
      if (publication.source === Track.Source.Microphone) {
        mediaControls.setMicEnabled(true)
      } else if (publication.source === Track.Source.Camera) {
        mediaControls.setCameraEnabled(true)
      }
    }

    localParticipant.on('trackMuted', handleTrackMuted)
    localParticipant.on('trackUnmuted', handleTrackUnmuted)

    return () => {
      localParticipant.off('trackMuted', handleTrackMuted)
      localParticipant.off('trackUnmuted', handleTrackUnmuted)
    }
  }, [localParticipant, mediaControls])

  if (!room) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white-700">Initializing...</p>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white-700">Connecting...</p>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* AI Title Header - Top Left */}
      <div className="absolute top-3 left-1 z-50 pointer-events-none">
        <div className="flex flex-col gap-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-lg">
          <h1 className="text-sm text-white-600">{displayTitle}</h1>
        </div>
      </div>

      {/* End Session Button - Top Right */}
      {isCreator && (
        <div className="absolute top-2.5 right-4 z-50">
          <button
            onClick={handleEndForEveryone}
            disabled={isPending}
            className="text-sm text-white-600 hover:text-white-900 transition-colors cursor-pointer disabled:opacity-60"
          >
            {isPending ? 'Exiting...' : 'end session'}
          </button>
        </div>
      )}

      {/* Current Topic Bubble - Bottom Left (expandable with history) */}
      {!sttReady && transcriptionToken ? (
        <CurrentTopicBubble topic="Connecting to voice…" topics={[]} variant="connecting" />
      ) : (
        <CurrentTopicBubble topic={currentTopicLabel} topics={topics} />
      )}

      <div className="flex-1 min-w-0 relative">
        <VideoGrid 
          localParticipant={localParticipant}
          remoteParticipants={remoteParticipants}
        />
      </div>
      <div className="p-4 pb-4">
        <ControlBar
          onMicrophoneToggle={handleMicrophoneToggle}
          onCameraToggle={handleCameraToggle}
          onScreenShareToggle={handleScreenShareToggle}
          onLeave={handleLeave}
          microphoneEnabled={mediaControls.micEnabled}
          microphoneConnecting={!sttReady && !!transcriptionToken}
          cameraEnabled={mediaControls.cameraEnabled}
          screenShareEnabled={mediaControls.screenShareEnabled}
          isCreator={isCreator}
        />
      </div>
      <TranscriptSidebar sessionSlug={sessionSlug} />
    </div>
  )
}


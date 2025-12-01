'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Room, Track, ConnectionState, RoomEvent } from 'livekit-client'
import { TranscriptSidebar } from '@/components/call/TranscriptSidebar'
import { TranscriptProvider, useTranscriptContext } from '@/contexts/TranscriptContext'
import { useLocalParticipantTranscription } from '@/hooks/useLocalParticipantTranscription'
import { useRoom } from '@/hooks/useRoom'
import { useParticipants } from '@/hooks/useParticipants'
import { VideoGrid } from '@/shared/ui/video-grid'
import { ControlBar } from '@/shared/ui/control-bar'
import { GuestJoinGate } from '@/shared/ui/guest-join-gate/GuestJoinGate'

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

export default function SessionPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()
  const slug = typeof params.slug === 'string' ? params.slug : params.slug?.[0] || ''
  const [data, setData] = useState<TokenResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guest, setGuest] = useState<{ identity: string; displayName: string } | null>(null)

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

    // Автоматически запрашиваем токен с displayName из сессии
    fetchToken(userDisplayName)
      return
    }

    // Если гость
    if (guest) {
      fetchToken(guest.displayName, guest.identity)
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
        throw new Error('Failed to fetch token')
      }
      const json = (await res.json()) as TokenResponse
      setData(json)
    } catch (err) {
      console.error(err)
      setError('Error while connecting to the session')
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
        <div className="text-center">
          <p className="mb-4">{error}</p>
          <button
            onClick={() => router.push('/sessions')}
            className="rounded-full px-4 py-2 bg-white text-black text-sm"
          >
            Back to sessions
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <p className="text-sm text-white-700">Connecting to the session...</p>
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
}) {
  const { room, isConnected, connectionState } = useRoom(token, serverUrl)
  const { localParticipant, remoteParticipants } = useParticipants(room)
  
  // Инициализируем начальное состояние микрофона - по умолчанию микрофон включен в LiveKit
  // Поэтому начальное значение должно быть true (включен), но это обновится через useEffect
  const [micEnabled, setMicEnabled] = useState(true) // По умолчанию микрофон включен
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
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
        micEnabled={micEnabled}
        setMicEnabled={setMicEnabled}
        cameraEnabled={cameraEnabled}
        setCameraEnabled={setCameraEnabled}
        screenShareEnabled={screenShareEnabled}
        setScreenShareEnabled={setScreenShareEnabled}
        participantJoinedRef={participantJoinedRef}
        transcriptionToken={transcriptionToken}
        sessionCreatedByUserId={sessionCreatedByUserId}
        currentUserId={currentUserId}
        identity={identity}
        displayName={displayName}
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
  micEnabled,
  setMicEnabled,
  cameraEnabled,
  setCameraEnabled,
  screenShareEnabled,
  setScreenShareEnabled,
  participantJoinedRef,
  transcriptionToken,
  sessionCreatedByUserId,
  currentUserId,
  identity,
  displayName,
}: {
  sessionSlug: string
  router: ReturnType<typeof useRouter>
  room: Room | null
  isConnected: boolean
  connectionState: ConnectionState
  localParticipant: any
  remoteParticipants: any[]
  micEnabled: boolean
  setMicEnabled: (enabled: boolean) => void
  cameraEnabled: boolean
  setCameraEnabled: (enabled: boolean) => void
  screenShareEnabled: boolean
  setScreenShareEnabled: (enabled: boolean) => void
  participantJoinedRef: React.MutableRefObject<boolean>
  transcriptionToken?: string
  sessionCreatedByUserId?: string | null
  currentUserId?: string
  identity: string
  displayName: string
}) {

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
          console.error('[SessionContent] Failed to join participant:', res.status, await res.text())
          // Не блокируем работу, если join не удался
          return
        }

        const participant = await res.json() as ParticipantJoinResponse
        console.log('[SessionContent] Participant joined successfully', { 
          participantId: participant.id,
          role: participant.role,
        })
      } catch (error) {
        console.error('[SessionContent] Error joining participant:', error)
        // Не блокируем работу, если join не удался
      }
    }

    joinParticipant()
  }, [room, isConnected, connectionState, identity, displayName, sessionSlug])

  // Состояние для transcription host (может динамически изменяться при уходе старого host)
  // Начальное значение: создатель сессии (sessionCreatedByUserId === currentUserId)
  // Может измениться через координацию через LiveKit data channel
  const [currentTranscriptionHostIdentity, setCurrentTranscriptionHostIdentity] = useState<string | null>(() => {
    // При первоначальной загрузке: если мы создатель сессии, мы и есть host
    if (sessionCreatedByUserId && currentUserId && currentUserId === sessionCreatedByUserId) {
      return identity
    }
    return null
  })
  
  // Определяем, является ли текущий участник "designated host" для транскрипции
  const isTranscriptionHost = currentTranscriptionHostIdentity === identity

  console.log('[SessionContent] Transcription host status', {
    isTranscriptionHost,
    currentTranscriptionHostIdentity,
    currentUserId,
    sessionCreatedByUserId,
    identity,
  })

  // Транскрипция
  const { start, stop, isActive, setOnTranscriptCallback } = useLocalParticipantTranscription({ 
    sessionSlug,
    room,
    localParticipant,
    connectionState,
    transcriptionToken,
    isTranscriptionHost, // Только host запускает транскрипцию
    userId: currentUserId, // Передаём userId для учёта использования
  })
  // Используем контекст транскрипции для изоляции от остального UI
  // Контекст обрабатывает получение транскриптов через LiveKit data channel
  const { addMessage } = useTranscriptContext()
  
  console.log('[SessionContent] Transcript context initialized', {
    isTranscriptionHost,
    roomState: room?.state,
    hasRoom: !!room,
  })

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

  // Связываем транскрипцию
  // ВАЖНО: каждый участник устанавливает callback для локального отображения своих транскриптов
  // Все транскрипты также отправляются через LiveKit data channel для других участников
  useEffect(() => {
    // Все участники устанавливают callback для локального отображения
    setOnTranscriptCallback(addMessage)
    console.log('[SessionContent] Transcription callback set for local participant')
    return () => {
      setOnTranscriptCallback(null)
    }
  }, [setOnTranscriptCallback, addMessage])

  // Слушаем события отключения участников и обрабатываем уход transcription host
  useEffect(() => {
    if (!room) return

    const handleParticipantDisconnected = async (participant: any) => {
      // Проверяем, был ли отключившийся участник transcription host
      if (participant.identity === currentTranscriptionHostIdentity) {
        console.log('[SessionContent] Transcription host disconnected, selecting new host...', {
          disconnectedHostIdentity: participant.identity,
        })

        try {
          // Запрашиваем нового host через API
          const res = await fetch(`/api/sessions/${sessionSlug}/transcription-host`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excludeIdentity: participant.identity, // Исключаем ушедшего участника
            }),
          })

          if (!res.ok) {
            console.error('[SessionContent] Failed to select new transcription host:', res.status)
            return
          }

          const { newHostIdentity, newHostUserId, newHostName } = await res.json()

          if (!newHostIdentity) {
            console.warn('[SessionContent] No available participants to become transcription host')
            setCurrentTranscriptionHostIdentity(null)
            return
          }

          console.log('[SessionContent] New transcription host selected', {
            newHostIdentity,
            newHostUserId,
            newHostName,
          })

          // Отправляем уведомление через LiveKit data channel всем участникам
          if (localParticipant && room.state === ConnectionState.Connected) {
            const notification = JSON.stringify({
              type: 'transcription-host-changed',
              newHostIdentity,
              newHostUserId,
              newHostName,
              timestamp: Date.now(),
            })
            
            try {
              localParticipant.publishData(
                new TextEncoder().encode(notification),
                { reliable: true }
              )
              console.log('[SessionContent] ✅ Published transcription host change notification')
            } catch (error) {
              console.error('[SessionContent] Failed to publish host change notification:', error)
            }
          }

          // Обновляем состояние (для текущего клиента)
          setCurrentTranscriptionHostIdentity(newHostIdentity)
        } catch (error) {
          console.error('[SessionContent] Error selecting new transcription host:', error)
        }
      }
    }

    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)

    return () => {
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    }
  }, [room, sessionSlug, localParticipant, currentTranscriptionHostIdentity, connectionState])

  // Слушаем сообщения о смене transcription host через LiveKit data channel
  // ВАЖНО: Этот handler обрабатывает только сообщения о смене host
  // Обычные транскрипты обрабатываются в TranscriptContext
  useEffect(() => {
    if (!room) return

    const handleData = (payload: Uint8Array, participant?: any) => {
      // Игнорируем собственные сообщения (local echo protection)
      const local = room?.localParticipant
      if (local && participant && participant.identity === local.identity) {
        return
      }

      try {
        const json = JSON.parse(new TextDecoder().decode(payload))
        
        // Обрабатываем только сообщения о смене host, транскрипты обрабатываются в useTranscriptStream
        if (json?.type === 'transcription-host-changed') {
          const { newHostIdentity, newHostUserId, newHostName } = json
          
          console.log('[SessionContent] Received transcription host change notification', {
            newHostIdentity,
            newHostUserId,
            newHostName,
            currentIdentity: identity,
            currentHostIdentity: currentTranscriptionHostIdentity,
            willBecomeHost: newHostIdentity === identity,
            wasHost: currentTranscriptionHostIdentity === identity,
          })

          // Обновляем состояние на всех клиентах
          // ВАЖНО: Обновляем только если host действительно изменился
          if (newHostIdentity !== currentTranscriptionHostIdentity) {
            setCurrentTranscriptionHostIdentity(newHostIdentity)
            
            // Если мы стали новым host, логируем это
            if (newHostIdentity === identity) {
              console.log('[SessionContent] 🎯 We became the new transcription host!')
            } else if (currentTranscriptionHostIdentity === identity) {
              console.log('[SessionContent] ⚠️ We are no longer the transcription host')
            }
          }
        }
      } catch (e) {
        // Игнорируем ошибки парсинга (могут быть другие типы сообщений, например транскрипты)
      }
    }

    room.on('dataReceived', handleData)

    return () => {
      room.off('dataReceived', handleData)
    }
  }, [room, identity, currentTranscriptionHostIdentity])

  // Автозапуск транскрипции для всех участников
  useEffect(() => {
    console.log('[SessionContent] Transcription state', {
      isActive,
      connectionState,
      hasStart: !!start,
    })
    if (!isActive && connectionState === ConnectionState.Connected) {
      console.log('[SessionContent] Starting transcription (automatic for all participants)')
      start()
    }
  }, [isActive, start, connectionState])

  // Флаг для отслеживания, покинул ли пользователь сессию сам
  const isUserLeavingRef = useRef(false)

  const handleMicrophoneToggle = async (enabled: boolean) => {
    if (!localParticipant) {
      console.warn('[SessionContent] handleMicrophoneToggle: no localParticipant')
      return
    }

    const currentState = micEnabled
    console.log('[SessionContent] handleMicrophoneToggle called', {
      requested: enabled,
      currentUIState: currentState,
      currentMicPub: localParticipant.getTrackPublication(Track.Source.Microphone)?.isMuted,
    })
    
    // Оптимистичное обновление UI - сразу обновляем состояние для мгновенной реакции кнопки
    setMicEnabled(enabled)
    
    try {
      await localParticipant.setMicrophoneEnabled(enabled)
      
      // Даем событиям LiveKit время прийти (100ms), затем проверяем реальное состояние
      // Это нужно, чтобы UI синхронизировался с реальным состоянием после переключения
      setTimeout(() => {
        const micPub = localParticipant?.getTrackPublication(Track.Source.Microphone)
      if (micPub) {
          const actualEnabled = !micPub.isMuted
          console.log('[SessionContent] Microphone state sync after toggle', {
            requested: enabled,
            actual: actualEnabled,
            isMuted: micPub.isMuted,
          })
          // Обновляем только если состояние отличается от запрошенного
          // (чтобы не конфликтовать с событиями LiveKit)
          if (actualEnabled !== enabled) {
            setMicEnabled(actualEnabled)
      }
        }
      }, 100)
    } catch (error) {
      console.error('Failed to toggle microphone:', error)
      
      // При ошибке откатываем к реальному состоянию
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
      if (micPub) {
        setMicEnabled(!micPub.isMuted)
      } else {
        setMicEnabled(false)
      }
    }
  }

  const handleCameraToggle = async (enabled: boolean) => {
    if (!localParticipant) return
    try {
      await localParticipant.setCameraEnabled(enabled)
      setCameraEnabled(enabled)
    } catch (error) {
      console.error('Failed to toggle camera:', error)
    }
  }

  const handleScreenShareToggle = async (enabled: boolean) => {
    if (!localParticipant) return
    try {
      if (enabled) {
        await localParticipant.setScreenShareEnabled(true, {
          audio: true,
          selfBrowserSurface: 'include',
        })
      } else {
        await localParticipant.setScreenShareEnabled(false)
      }
      setScreenShareEnabled(enabled)
    } catch (error) {
      console.error('Failed to toggle screen share:', error)
    }
  }

  const handleLeave = () => {
    isUserLeavingRef.current = true
    if (room) {
      room.disconnect()
    }
    router.push('/sessions')
  }

  // Обновляем состояние кнопок на основе реального состояния треков
  useEffect(() => {
    if (!localParticipant) {
      // Если localParticipant еще нет, устанавливаем начальное состояние
      // По умолчанию в LiveKit микрофон включен при подключении
      setMicEnabled(true)
      return
    }

    const updateStates = () => {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
      const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera)
      const screenSharePub = localParticipant.getTrackPublication(Track.Source.ScreenShare)

      // Если публикации нет, микрофон считается включенным по умолчанию (LiveKit поведение)
      // Если публикация есть, проверяем isMuted
      const micEnabled = micPub ? !micPub.isMuted : true
      const camEnabled = cameraPub ? !cameraPub.isMuted : false
      const screenShareEnabled = screenSharePub ? !screenSharePub.isMuted : false

      console.log('[SessionContent] Track states updated', {
        micEnabled,
        camEnabled,
        screenShareEnabled,
        micPublication: micPub ? {
          trackSid: micPub.trackSid,
          isMuted: micPub.isMuted,
          hasTrack: !!micPub.track,
        } : null,
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

    // Обновляем состояние сразу при появлении localParticipant
    updateStates()

    const handleTrackPublished = () => updateStates()
    const handleTrackUnpublished = () => updateStates()
    const handleTrackMuted = () => updateStates()
    const handleTrackUnmuted = () => updateStates()

    localParticipant.on('trackPublished', handleTrackPublished)
    localParticipant.on('trackUnpublished', handleTrackUnpublished)
    localParticipant.on('trackMuted', handleTrackMuted)
    localParticipant.on('trackUnmuted', handleTrackUnmuted)

    return () => {
      localParticipant.off('trackPublished', handleTrackPublished)
      localParticipant.off('trackUnpublished', handleTrackUnpublished)
      localParticipant.off('trackMuted', handleTrackMuted)
      localParticipant.off('trackUnmuted', handleTrackUnmuted)
    }
  }, [localParticipant])

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
      <div className="flex-1 min-w-0 relative">
        <VideoGrid 
          localParticipant={localParticipant}
          remoteParticipants={remoteParticipants}
        />
      </div>
      <div className="p-4 pb-8">
        <ControlBar
          onMicrophoneToggle={handleMicrophoneToggle}
          onCameraToggle={handleCameraToggle}
          onScreenShareToggle={handleScreenShareToggle}
          onLeave={handleLeave}
          microphoneEnabled={micEnabled}
          cameraEnabled={cameraEnabled}
          screenShareEnabled={screenShareEnabled}
        />
      </div>
      <TranscriptSidebar sessionSlug={sessionSlug} />
    </div>
  )
}


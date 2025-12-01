'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Room, Track } from 'livekit-client'
import { TranscriptSidebar } from '@/components/call/TranscriptSidebar'
import { useLocalParticipantTranscription } from '@/hooks/useLocalParticipantTranscription'
import { useTranscriptStream } from '@/hooks/useTranscriptStream'
import { useRoom } from '@/hooks/useRoom'
import { useParticipants } from '@/hooks/useParticipants'
import { VideoGrid } from '@/shared/ui/video-grid'
import { ControlBar } from '@/shared/ui/control-bar'

interface TokenResponse {
  token: string
  roomName: string
  identity: string
  serverUrl: string
}

const DISPLAY_NAME_STORAGE_KEY = 'call_display_name'

export default function CallRoomPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const slug = typeof params.slug === 'string' ? params.slug : params.slug?.[0] || ''
  const [data, setData] = useState<TokenResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string>('')
  const [showNameInput, setShowNameInput] = useState(true)

  // Загружаем сохраненное имя из localStorage и автоматически подключаемся
  useEffect(() => {
    if (!slug) {
      setError('Invalid room slug')
      return
    }

    if (typeof window !== 'undefined') {
      const savedName = localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || ''
      if (savedName) {
        setDisplayName(savedName)
        setShowNameInput(false)
        // Автоматически запрашиваем токен с сохраненным именем
        fetchToken(savedName)
      }
    }
  }, [slug])

  const fetchToken = async (name: string) => {
    if (!name.trim()) {
      return
    }

    try {
      const res = await fetch(`/api/calls/${slug}/token?name=${encodeURIComponent(name.trim())}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('Room not found')
          return
        }
        throw new Error('Failed to fetch token')
      }
      const json = (await res.json()) as TokenResponse
      setData(json)
    } catch (err) {
      console.error(err)
      setError('Error while connecting to the room')
    }
  }

  const handleJoinCall = async () => {
    if (!displayName.trim()) {
      return
    }

    // Сохраняем имя в localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName.trim())
    }

    setShowNameInput(false)

    // Получаем токен с именем
    await fetchToken(displayName.trim())
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <div className="text-center">
          <p className="mb-4">{error}</p>
          <button
            onClick={() => router.push('/calls')}
            className="rounded-full px-4 py-2 bg-white text-black text-sm"
          >
            Back to calls
          </button>
        </div>
      </div>
    )
  }

  if (showNameInput) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl max-w-md w-full">
          <h1 className="text-2xl font-semibold mb-4">Join Call</h1>
          <p className="text-sm text-white-600 mb-6">
            Enter your display name to join the call
          </p>
          <div className="space-y-4">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && displayName.trim()) {
                  handleJoinCall()
                }
              }}
              placeholder="Your name"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white-900 placeholder-white-500 focus:outline-none focus:ring-2 focus:ring-white/50"
              autoFocus
            />
            <button
              onClick={handleJoinCall}
              disabled={!displayName.trim()}
              className="w-full inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Call
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
        <p className="text-sm text-white-700">Connecting to the room...</p>
      </div>
    )
  }

  return (
    <div className="w-full h-screen bg-surface-900 text-white-900">
      <CallRoomContent 
        roomSlug={slug} 
        router={router}
        token={data.token}
        serverUrl={data.serverUrl}
      />
    </div>
  )
}

function CallRoomContent({ 
  roomSlug, 
  router,
  token,
  serverUrl,
}: { 
  roomSlug: string
  router: ReturnType<typeof useRouter>
  token: string
  serverUrl: string
}) {
  const { room, isConnected } = useRoom(token, serverUrl)
  const { participants, localParticipant } = useParticipants(room)
  const [micEnabled, setMicEnabled] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)

  // Транскрипция
  const { start, isActive, setOnTranscriptCallback } = useLocalParticipantTranscription({ 
    roomSlug,
    room,
    localParticipant,
  })
  const { addMessage, messages } = useTranscriptStream({ roomSlug, room })

  // Автоматически включаем только микрофон при подключении (камера выключена по умолчанию)
  useEffect(() => {
    if (!room || !localParticipant) return

    const enableMedia = async () => {
      if (room.state === 'connected') {
        try {
          // Включаем только микрофон, камеру не включаем
          const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
          const isMicEnabled = micPub && !micPub.isMuted

          if (!isMicEnabled) {
            console.log('[CallRoomContent] Enabling microphone by default')
            await localParticipant.setMicrophoneEnabled(true)
          } else {
            console.log('[CallRoomContent] Microphone already enabled')
          }
        } catch (error) {
          console.error('[CallRoomContent] Failed to enable media:', error)
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
  useEffect(() => {
    setOnTranscriptCallback(addMessage)
    return () => {
      setOnTranscriptCallback(null)
    }
  }, [setOnTranscriptCallback, addMessage])

  // Автозапуск транскрипции
  useEffect(() => {
    console.log('[CallRoomContent] Transcription state', {
      isActive,
      roomState: room?.state,
      hasStart: !!start,
    })
    if (!isActive && room?.state === 'connected') {
      console.log('[CallRoomContent] Starting transcription')
      start()
    }
  }, [isActive, start, room?.state])

  // Флаг для отслеживания, покинул ли пользователь комнату сам
  const isUserLeavingRef = useRef(false)

  // УБРАЛИ автоматический редирект при disconnected
  // Теперь пользователь может оставаться в комнате даже при временных отключениях
  // Редирект происходит только при ручном нажатии кнопки Leave

  const handleMicrophoneToggle = async (enabled: boolean) => {
    if (!localParticipant) return
    try {
      await localParticipant.setMicrophoneEnabled(enabled)
      setMicEnabled(enabled)
    } catch (error) {
      console.error('Failed to toggle microphone:', error)
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
    router.push('/calls')
  }

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

      console.log('[CallRoomContent] Track states updated', {
        micEnabled,
        camEnabled,
        screenShareEnabled,
        cameraPub: cameraPub ? {
          trackId: cameraPub.track?.trackId,
          isMuted: cameraPub.isMuted,
          hasTrack: !!cameraPub.track,
        } : null,
      })

      setMicEnabled(micEnabled)
      setCameraEnabled(camEnabled)
      setScreenShareEnabled(screenShareEnabled)
    }

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
        <p className="text-white-700">Connecting... {room.state}</p>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex-1 min-w-0 relative">
        <VideoGrid 
          participants={participants}
          localParticipant={localParticipant || undefined}
          room={room}
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
      <TranscriptSidebar roomSlug={roomSlug} messages={messages} />
    </div>
  )
}


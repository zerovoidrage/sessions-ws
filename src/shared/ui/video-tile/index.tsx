'use client'

import { useEffect, useRef, HTMLAttributes, memo } from 'react'
import { Track } from 'livekit-client'
import { cn } from '@/lib/utils'

export interface VideoTileProps extends HTMLAttributes<HTMLDivElement> {
  track?: Track
  participantName?: string
  isLocal?: boolean
  isSpeaking?: boolean
}

function VideoTileComponent({
  track,
  participantName,
  isLocal = false,
  isSpeaking = false,
  className,
  ...props
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    if (!track) {
      // Если трека нет, очищаем элемент
      console.log('[VideoTile] No track, clearing video element', { participantName })
      videoElement.srcObject = null
      return
    }

    console.log('[VideoTile] Attaching track', { 
      participantName, 
      trackSid: track.sid,
      kind: track.kind,
      isMuted: track.isMuted,
      hasMediaStreamTrack: !!track.mediaStreamTrack,
    })

    // Проверяем, что трек активен
    if (track.isMuted) {
      console.warn('[VideoTile] Track is muted', {
        participantName,
        trackSid: track.sid,
      })
    }

    // Используем attach/detach от LiveKit для правильного управления треком
    try {
      track.attach(videoElement)

      // Пытаемся воспроизвести видео
      const playPromise = videoElement.play()
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.error('[VideoTile] Error playing video:', err)
        })
      }
    } catch (error) {
      console.error('[VideoTile] Error attaching track:', error)
    }

    // Подписываемся на изменения трека
    const handleTrackMuted = () => {
      console.log('[VideoTile] Track muted', { participantName, trackSid: track.sid })
      // При muted не очищаем элемент, просто останавливаем воспроизведение
    }
    const handleTrackUnmuted = () => {
      console.log('[VideoTile] Track unmuted', { participantName, trackSid: track.sid })
      // При unmuted пытаемся снова воспроизвести
      videoElement.play().catch((err) => {
        console.error('[VideoTile] Error playing video after unmute:', err)
      })
    }

    track.on('muted', handleTrackMuted)
    track.on('unmuted', handleTrackUnmuted)

    return () => {
      console.log('[VideoTile] Detaching track', { participantName, trackSid: track.sid })
      // Отключаем трек от элемента при размонтировании
      try {
        track.detach(videoElement)
      } catch (error) {
        console.error('[VideoTile] Error detaching track:', error)
      }
      track.off('muted', handleTrackMuted)
      track.off('unmuted', handleTrackUnmuted)
    }
  }, [track, participantName])

  return (
    <div
      className={cn(
        'relative w-full h-full bg-onsurface-800 rounded-md overflow-hidden min-h-0',
        isSpeaking && 'ring-2 ring-brand-green',
        className
      )}
      {...props}
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={cn(
            "w-full h-full object-cover object-center",
            isLocal && "scale-x-[-1]" // Зеркалируем локальное видео, как в Google Meet
          )}
        />
      ) : (
        // Не показываем placeholder - только пустой фон
        null
      )}
      {participantName && (
        <div className="absolute bottom-2 left-2">
          <span className="text-white-900 text-xs">{participantName}</span>
        </div>
      )}
    </div>
  )
}

// Мемоизируем VideoTile для предотвращения ненужных ре-рендеров
// Перерендерится только при изменении track, participantName, isLocal, isSpeaking
export const VideoTile = memo(VideoTileComponent, (prevProps, nextProps) => {
  // Сравниваем ключевые пропсы
  if (prevProps.track?.sid !== nextProps.track?.sid) return false
  if (prevProps.track?.isMuted !== nextProps.track?.isMuted) return false
  if (prevProps.participantName !== nextProps.participantName) return false
  if (prevProps.isLocal !== nextProps.isLocal) return false
  if (prevProps.isSpeaking !== nextProps.isSpeaking) return false
  if (prevProps.className !== nextProps.className) return false
  
  return true // Ре-рендер не нужен
})

VideoTile.displayName = 'VideoTile'


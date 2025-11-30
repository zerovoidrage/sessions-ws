'use client'

import { useEffect, useRef, HTMLAttributes } from 'react'
import { Track } from 'livekit-client'
import { cn } from '@/lib/utils'

export interface VideoTileProps extends HTMLAttributes<HTMLDivElement> {
  track?: Track
  participantName?: string
  isLocal?: boolean
  isSpeaking?: boolean
}

export function VideoTile({
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
      trackId: track.trackId,
      kind: track.kind,
      isMuted: track.isMuted,
      isSubscribed: track.isSubscribed,
      hasMediaStreamTrack: !!track.mediaStreamTrack,
    })

    // Проверяем, что трек активен
    if (track.isMuted) {
      console.warn('[VideoTile] Track is muted', {
        participantName,
        trackId: track.trackId,
      })
    }

    if (!track.isSubscribed) {
      console.warn('[VideoTile] Track is not subscribed', {
        participantName,
        trackId: track.trackId,
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
      console.log('[VideoTile] Track muted', { participantName, trackId: track.trackId })
      // При muted не очищаем элемент, просто останавливаем воспроизведение
    }
    const handleTrackUnmuted = () => {
      console.log('[VideoTile] Track unmuted', { participantName, trackId: track.trackId })
      // При unmuted пытаемся снова воспроизвести
      videoElement.play().catch((err) => {
        console.error('[VideoTile] Error playing video after unmute:', err)
      })
    }

    track.on('muted', handleTrackMuted)
    track.on('unmuted', handleTrackUnmuted)

    return () => {
      console.log('[VideoTile] Detaching track', { participantName, trackId: track.trackId })
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
        'relative w-full h-full bg-onsurface-800 rounded-md overflow-hidden',
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
          className="w-full h-full object-cover object-center"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-onsurface-800">
        </div>
      )}
      {participantName && (
        <div className="absolute bottom-2 left-2">
          <span className="text-white-900 text-xs">{participantName}</span>
        </div>
      )}
    </div>
  )
}


'use client'

import { useState, useEffect } from 'react'
import { Track, Participant, RemoteParticipant, LocalParticipant } from 'livekit-client'
import { VideoTile } from '../video-tile'
import { cn } from '@/lib/utils'

export interface VideoGridProps {
  localParticipant: LocalParticipant | null
  remoteParticipants: RemoteParticipant[]
  className?: string
}

export function VideoGrid({ localParticipant, remoteParticipants, className }: VideoGridProps) {
  const [, forceUpdate] = useState(0)

  // Подписываемся на изменения треков у всех участников для обновления UI
  useEffect(() => {
    const allParticipants = [
      ...(localParticipant ? [localParticipant] : []),
      ...remoteParticipants,
    ]

    if (allParticipants.length === 0) return

    const handleTrackChanged = () => {
      // Принудительно обновляем компонент при изменении треков
      forceUpdate((prev) => prev + 1)
    }

    const listeners: Array<() => void> = []

    // Подписываемся на события треков у каждого участника
    allParticipants.forEach((participant) => {
      const handleTrackPublished = () => handleTrackChanged()
      const handleTrackUnpublished = () => handleTrackChanged()
      const handleTrackMuted = () => handleTrackChanged()
      const handleTrackUnmuted = () => handleTrackChanged()

      participant.on('trackPublished', handleTrackPublished)
      participant.on('trackUnpublished', handleTrackUnpublished)
      participant.on('trackMuted', handleTrackMuted)
      participant.on('trackUnmuted', handleTrackUnmuted)

      listeners.push(() => {
        participant.off('trackPublished', handleTrackPublished)
        participant.off('trackUnpublished', handleTrackUnpublished)
        participant.off('trackMuted', handleTrackMuted)
        participant.off('trackUnmuted', handleTrackUnmuted)
      })
    })

    return () => {
      listeners.forEach((cleanup) => cleanup())
    }
  }, [localParticipant, remoteParticipants])

  // Собираем массив всех участников
  const allParticipants = [
    ...(localParticipant ? [localParticipant] : []),
    ...remoteParticipants,
  ]

  const getVideoTrack = (participant: Participant) => {
    // Ищем активный видео-трек (не muted и с track)
    const allVideoPubs = Array.from(participant.videoTrackPublications.values())
    
    const videoPub = allVideoPubs.find((pub) => {
      // Проверяем, что трек существует, не muted, и это камера (не screen share)
      return pub.track && !pub.isMuted && pub.source === Track.Source.Camera
    })
    
    return videoPub?.track
  }

  const getAudioTrack = (participant: Participant) => {
    return Array.from(participant.audioTrackPublications.values())
      .find((pub) => pub.track && !pub.isMuted)
      ?.track
  }

  if (allParticipants.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-white-600">No participants</p>
      </div>
    )
  }

  if (allParticipants.length === 1) {
    const participant = allParticipants[0]
    const videoTrack = getVideoTrack(participant)
    const isLocal = participant instanceof LocalParticipant

    return (
      <div className={cn('w-full h-full flex items-center justify-center', className)}>
        <div className="aspect-[3/3.5] w-[35vh] max-w-[450px] max-h-[600px]">
          <VideoTile
            track={videoTrack}
            participantName={participant.name || participant.identity}
            isLocal={isLocal}
          />
        </div>
      </div>
    )
  }

  // Grid layout for multiple participants
  const getGridCols = () => {
    if (allParticipants.length <= 2) return 2
    if (allParticipants.length <= 4) return 2
    return 3
  }

  const gridCols = getGridCols()

  return (
    <div
      className={cn(
        'grid gap-4 w-full h-full p-4',
        className
      )}
      style={{
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
      }}
    >
      {allParticipants.map((participant) => {
        const videoTrack = getVideoTrack(participant)
        const audioTrack = getAudioTrack(participant)
        const isLocal = participant instanceof LocalParticipant
        const isSpeaking = audioTrack !== undefined

        return (
          <VideoTile
            key={participant.identity}
            track={videoTrack}
            participantName={participant.name || participant.identity}
            isLocal={isLocal}
            isSpeaking={isSpeaking}
          />
        )
      })}
    </div>
  )
}


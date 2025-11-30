'use client'

import { useState, useEffect } from 'react'
import { Track, Participant, RemoteParticipant, LocalParticipant, RoomEvent } from 'livekit-client'
import { VideoTile } from '../video-tile'
import { cn } from '@/lib/utils'

export interface VideoGridProps {
  participants: (LocalParticipant | RemoteParticipant)[]
  localParticipant?: LocalParticipant
  room?: any // Room для подписки на события
  className?: string
}

export function VideoGrid({ participants, localParticipant, room, className }: VideoGridProps) {
  const [, forceUpdate] = useState(0)

  // Подписываемся на изменения треков, чтобы обновлять UI
  useEffect(() => {
    if (!room) return

    const handleTrackChanged = (track: any, publication: any, participant: any) => {
      console.log('[VideoGrid] Track changed', {
        trackId: track?.trackId,
        source: publication?.source,
        participant: participant?.identity,
        isMuted: publication?.isMuted,
      })
      // Принудительно обновляем компонент при изменении треков
      forceUpdate((prev) => prev + 1)
    }

    const handleTrackPublished = (publication: any, participant: any) => {
      console.log('[VideoGrid] Track published', {
        source: publication?.source,
        participant: participant?.identity,
        hasTrack: !!publication?.track,
      })
      forceUpdate((prev) => prev + 1)
    }

    const handleTrackUnpublished = (publication: any, participant: any) => {
      console.log('[VideoGrid] Track unpublished', {
        source: publication?.source,
        participant: participant?.identity,
      })
      forceUpdate((prev) => prev + 1)
    }

    room.on(RoomEvent.TrackPublished, handleTrackPublished)
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished)
    room.on(RoomEvent.TrackSubscribed, handleTrackChanged)
    room.on(RoomEvent.TrackUnsubscribed, handleTrackChanged)
    room.on(RoomEvent.TrackMuted, handleTrackChanged)
    room.on(RoomEvent.TrackUnmuted, handleTrackChanged)

    // Также подписываемся на события участника
    if (localParticipant) {
      localParticipant.on('trackPublished', handleTrackPublished)
      localParticipant.on('trackUnpublished', handleTrackUnpublished)
      localParticipant.on('trackMuted', handleTrackChanged)
      localParticipant.on('trackUnmuted', handleTrackChanged)
    }

    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished)
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished)
      room.off(RoomEvent.TrackSubscribed, handleTrackChanged)
      room.off(RoomEvent.TrackUnsubscribed, handleTrackChanged)
      room.off(RoomEvent.TrackMuted, handleTrackChanged)
      room.off(RoomEvent.TrackUnmuted, handleTrackChanged)
      
      if (localParticipant) {
        localParticipant.off('trackPublished', handleTrackPublished)
        localParticipant.off('trackUnpublished', handleTrackUnpublished)
        localParticipant.off('trackMuted', handleTrackChanged)
        localParticipant.off('trackUnmuted', handleTrackChanged)
      }
    }
  }, [room, localParticipant])

  const allParticipants = localParticipant 
    ? [localParticipant, ...participants.filter(p => p.identity !== localParticipant.identity)]
    : participants

  const getVideoTrack = (participant: Participant) => {
    // Ищем активный видео-трек (не muted и с track)
    const allVideoPubs = Array.from(participant.videoTrackPublications.values())
    
    const videoPub = allVideoPubs.find((pub) => {
      // Проверяем, что трек существует, не muted, и это не screen share
      const isValid = pub.track && 
                      !pub.isMuted && 
                      pub.source === Track.Source.Camera
      
      if (pub.track && pub.source === Track.Source.Camera) {
        console.log('[VideoGrid] Camera track found', {
          participant: participant.identity,
          trackId: pub.track.trackId,
          isMuted: pub.isMuted,
          isValid,
        })
      }
      
      return isValid
    })
    
    if (!videoPub && allVideoPubs.length > 0) {
      console.log('[VideoGrid] No valid camera track found', {
        participant: participant.identity,
        availablePubs: allVideoPubs.map(p => ({
          source: p.source,
          isMuted: p.isMuted,
          hasTrack: !!p.track,
        })),
      })
    }
    
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


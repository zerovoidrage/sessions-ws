'use client'

import { useState, useEffect, useRef } from 'react'
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

    // Подписываемся на изменения speaking state через периодическую проверку
    // LiveKit обновляет participant.isSpeaking автоматически, но не имеет события для этого
    const speakingCheckInterval = setInterval(() => {
      forceUpdate((prev) => prev + 1)
    }, 150) // Проверяем каждые 150ms для плавной анимации

    listeners.push(() => {
      clearInterval(speakingCheckInterval)
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

  // Прикрепляем аудио треки remote участников к скрытым audio элементам для воспроизведения
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const attachedTracksRef = useRef<Map<string, Track>>(new Map())

  useEffect(() => {
    const updateAudioTracks = () => {
      // Обрабатываем только remote участников (local participant не воспроизводим)
      remoteParticipants.forEach((participant) => {
        const audioTrack = getAudioTrack(participant)
        const participantIdentity = participant.identity
        
        // Получаем или создаем audio элемент для этого участника
        let audioElement = audioElementsRef.current.get(participantIdentity)
        
        if (!audioElement) {
          audioElement = document.createElement('audio')
          audioElement.autoplay = true
          audioElement.setAttribute('playsinline', 'true')
          audioElement.style.display = 'none'
          document.body.appendChild(audioElement)
          audioElementsRef.current.set(participantIdentity, audioElement)
        }

        const previouslyAttachedTrack = attachedTracksRef.current.get(participantIdentity)

        // Если трек изменился, отключаем старый
        if (previouslyAttachedTrack && previouslyAttachedTrack !== audioTrack) {
          try {
            previouslyAttachedTrack.detach(audioElement)
          } catch (error) {
            console.error('[VideoGrid] Error detaching previous audio track:', error)
          }
          attachedTracksRef.current.delete(participantIdentity)
        }

        // Прикрепляем новый трек, если он есть
        if (audioTrack && audioTrack !== previouslyAttachedTrack) {
          try {
            audioTrack.attach(audioElement)
            attachedTracksRef.current.set(participantIdentity, audioTrack)
            audioElement.play().catch((err) => {
              console.error('[VideoGrid] Error playing remote audio:', err, { participantIdentity })
            })
          } catch (error) {
            console.error('[VideoGrid] Error attaching remote audio track:', error, { participantIdentity })
          }
        } else if (!audioTrack && previouslyAttachedTrack) {
          // Если трека больше нет, отключаем
          try {
            previouslyAttachedTrack.detach(audioElement)
          } catch (error) {
            console.error('[VideoGrid] Error detaching audio track:', error)
          }
          attachedTracksRef.current.delete(participantIdentity)
        }
      })

      // Очищаем audio элементы для участников, которые больше не в списке
      const currentIdentities = new Set(remoteParticipants.map((p) => p.identity))
      audioElementsRef.current.forEach((audioElement, identity) => {
        if (!currentIdentities.has(identity)) {
          const attachedTrack = attachedTracksRef.current.get(identity)
          try {
            if (attachedTrack) {
              attachedTrack.detach(audioElement)
            }
            audioElement.remove()
          } catch (error) {
            console.error('[VideoGrid] Error removing audio element:', error)
          }
          audioElementsRef.current.delete(identity)
          attachedTracksRef.current.delete(identity)
        }
      })
    }

    // Обновляем при изменении участников
    updateAudioTracks()

    // Подписываемся на изменения треков для обновления аудио
    const listeners: Array<() => void> = []
    remoteParticipants.forEach((participant) => {
      const handleTrackPublished = () => {
        updateAudioTracks()
        forceUpdate((prev) => prev + 1)
      }
      const handleTrackUnpublished = () => {
        updateAudioTracks()
        forceUpdate((prev) => prev + 1)
      }
      const handleTrackMuted = () => {
        updateAudioTracks()
        forceUpdate((prev) => prev + 1)
      }
      const handleTrackUnmuted = () => {
        updateAudioTracks()
        forceUpdate((prev) => prev + 1)
      }

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

    // Очистка при размонтировании
    return () => {
      listeners.forEach((cleanup) => cleanup())
      audioElementsRef.current.forEach((audioElement, identity) => {
        const attachedTrack = attachedTracksRef.current.get(identity)
        try {
          if (attachedTrack) {
            attachedTrack.detach(audioElement)
          }
          audioElement.remove()
        } catch (error) {
          console.error('[VideoGrid] Error cleaning up audio element:', error)
        }
      })
      audioElementsRef.current.clear()
      attachedTracksRef.current.clear()
    }
  }, [remoteParticipants])

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
    const isSpeaking = participant.isSpeaking ?? false

    return (
      <div className={cn('w-full h-full flex items-center justify-center', className)}>
        <div className="aspect-[3/3] w-[60vh] max-w-[300px] max-h-[600px]">
          <VideoTile
            track={videoTrack}
            participantName={participant.name || participant.identity}
            isLocal={isLocal}
            isSpeaking={isSpeaking}
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
        const isLocal = participant instanceof LocalParticipant
        // Используем реальное состояние speaking из LiveKit (определяется по активности аудио)
        const isSpeaking = participant.isSpeaking ?? false

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


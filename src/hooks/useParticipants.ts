'use client'

import { useEffect, useState } from 'react'
import { Room, RoomEvent, RemoteParticipant, LocalParticipant } from 'livekit-client'

export interface ParticipantsState {
  localParticipant: LocalParticipant | null
  remoteParticipants: RemoteParticipant[]
}

export function useParticipants(room: Room | null): ParticipantsState {
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null)
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([])

  useEffect(() => {
    if (!room) {
      setLocalParticipant(null)
      setRemoteParticipants([])
      return
    }

    // Функция синхронизации состояния из Room
    const syncFromRoom = () => {
      const local = room.localParticipant
      const remote = Array.from(room.remoteParticipants.values())
      
      setLocalParticipant(local)
      setRemoteParticipants(remote)

      // Защитное логирование в dev
      if (process.env.NODE_ENV === 'development') {
        console.debug('[useParticipants] Synced from room', {
          localIdentity: local?.identity || null,
          remoteIdentities: remote.map(p => p.identity),
          totalParticipants: 1 + remote.length, // local + remote
        })
      }
    }

    // Синхронизируем сразу
    syncFromRoom()

    // Подписываемся на события изменения участников
    const handleParticipantConnected = () => {
      syncFromRoom()
    }

    const handleParticipantDisconnected = () => {
      syncFromRoom()
    }

    // Подписываемся на события треков (т.к. они могут влиять на отображение участников)
    const handleTrackSubscribed = () => {
      syncFromRoom()
    }

    const handleTrackUnsubscribed = () => {
      syncFromRoom()
    }

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)

    return () => {
      // Cleanup: удаляем все listeners
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    }
  }, [room])

  return { localParticipant, remoteParticipants }
}



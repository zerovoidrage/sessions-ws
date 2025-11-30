'use client'

import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent, RemoteParticipant, LocalParticipant } from 'livekit-client'

export function useRoom(token: string, serverUrl: string) {
  const [room, setRoom] = useState<Room | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const roomRef = useRef<Room | null>(null)

  useEffect(() => {
    if (!token || !serverUrl) return

    // Предотвращаем множественные подключения
    if (roomRef.current) {
      return
    }

    const newRoom = new Room()
    roomRef.current = newRoom

    const handleConnected = () => {
      console.log('[useRoom] Room connected', { state: newRoom.state })
      setIsConnected(true)
      setError(null)
    }

    const handleDisconnected = () => {
      console.log('[useRoom] Room disconnected')
      setIsConnected(false)
    }

    const handleError = (err: Error) => {
      console.error('[useRoom] Room error:', err)
      setError(err)
      setIsConnected(false)
    }

    // Подписываемся на события ДО подключения
    newRoom.on(RoomEvent.Connected, handleConnected)
    newRoom.on(RoomEvent.Disconnected, handleDisconnected)
    newRoom.on(RoomEvent.ConnectionQualityChanged, () => {})
    newRoom.on(RoomEvent.Error, handleError)

    setRoom(newRoom)

    console.log('[useRoom] Connecting to room...', { serverUrl, tokenLength: token.length })
    
    // Подключаемся к комнате
    newRoom.connect(serverUrl, token)
      .then(() => {
        console.log('[useRoom] Connect promise resolved', { state: newRoom.state })
        // Проверяем состояние после подключения
        if (newRoom.state === 'connected') {
          handleConnected()
        }
      })
      .catch((err) => {
        console.error('[useRoom] Failed to connect to room:', err)
        setError(err)
      })

    return () => {
      // В cleanup только отписываемся от событий, НЕ отключаем комнату
      // Отключение происходит только при явном вызове disconnect() через handleLeave
      const currentRoom = roomRef.current
      if (!currentRoom || currentRoom !== newRoom) return

      currentRoom.off(RoomEvent.Connected, handleConnected)
      currentRoom.off(RoomEvent.Disconnected, handleDisconnected)
      currentRoom.off(RoomEvent.Error, handleError)
      
      // Если token или serverUrl изменились, отключаем старую комнату
      if (currentRoom.state === 'connected' || currentRoom.state === 'connecting') {
        console.log('[useRoom] Token/serverUrl changed, disconnecting old room')
        currentRoom.disconnect()
        roomRef.current = null
      }
    }
  }, [token, serverUrl])

  // Cleanup при размонтировании компонента
  // НЕ отключаем комнату автоматически - это вызывает проблемы в Strict Mode
  // Комната отключается только при явном вызове disconnect() через handleLeave

  return { room, isConnected, error }
}

export function useParticipants(room: Room | null) {
  const [participants, setParticipants] = useState<(LocalParticipant | RemoteParticipant)[]>([])
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null)

  useEffect(() => {
    if (!room) {
      setParticipants([])
      setLocalParticipant(null)
      return
    }

    const updateParticipants = () => {
      const remote = Array.from(room.remoteParticipants.values())
      const local = room.localParticipant
      setParticipants(remote)
      setLocalParticipant(local)
    }

    updateParticipants()

    const handleParticipantConnected = () => {
      updateParticipants()
    }

    const handleParticipantDisconnected = () => {
      updateParticipants()
    }

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    }
  }, [room])

  return { participants, localParticipant }
}


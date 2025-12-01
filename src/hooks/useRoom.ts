'use client'

import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent, ConnectionState } from 'livekit-client'

export function useRoom(token: string, serverUrl: string) {
  const [room, setRoom] = useState<Room | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [error, setError] = useState<Error | null>(null)
  const roomRef = useRef<Room | null>(null)
  const lastTokenRef = useRef<string | null>(null)
  const lastUrlRef = useRef<string | null>(null)

  // Простая хеш-функция для логирования токена (безопасно)
  const hashToken = (t: string) => {
    let hash = 0
    for (let i = 0; i < Math.min(t.length, 20); i++) {
      const char = t.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  useEffect(() => {
    if (!token || !serverUrl) {
      setRoom(null)
      setIsConnected(false)
      setConnectionState(ConnectionState.Disconnected)
      return
    }

    // Если уже есть room с тем же token/serverUrl — ничего не делаем
    if (
      roomRef.current &&
      lastTokenRef.current === token &&
      lastUrlRef.current === serverUrl
    ) {
      return
    }

    // Если room был, но токен/URL изменились — аккуратно отключаем
    if (roomRef.current) {
      const oldRoom = roomRef.current
      console.info('[useRoom] Token/URL changed, disconnecting old room', {
        oldTokenHash: lastTokenRef.current ? hashToken(lastTokenRef.current) : null,
        newTokenHash: hashToken(token),
        oldUrl: lastUrlRef.current,
        newUrl: serverUrl,
      })
      
      try {
        oldRoom.disconnect()
      } catch (e) {
        console.warn('[useRoom] Error disconnecting old room on token/url change', e)
      }
      
      roomRef.current = null
      setRoom(null)
      setIsConnected(false)
      setConnectionState(ConnectionState.Disconnected)
    }

    // Создаем новый Room инстанс
    const newRoom = new Room()
    roomRef.current = newRoom
    setRoom(newRoom)
    lastTokenRef.current = token
    lastUrlRef.current = serverUrl

    let cancelled = false

    // Функция подключения
    async function connect() {
      if (cancelled) return

      try {
        setConnectionState(newRoom.state)
        console.info('[useRoom] Connecting to room...', {
          serverUrl,
          tokenHash: hashToken(token),
          currentState: newRoom.state,
        })

        await newRoom.connect(serverUrl, token)
        
        if (cancelled) return
        
        const finalState = newRoom.state
        setConnectionState(finalState)
        
        if (finalState === 'connected') {
          setIsConnected(true)
          setError(null)
          console.info('[useRoom] Room connected successfully', { state: finalState })
        } else {
          setIsConnected(false)
          console.warn('[useRoom] Room connect completed but state is not connected', { state: finalState })
        }
      } catch (e) {
        if (cancelled) return
        
        console.error('[useRoom] Connect error', e)
        setError(e as Error)
        setIsConnected(false)
        setConnectionState(newRoom.state)
      }
    }

    // Обработчик изменения состояния комнаты через room.state
    // LiveKit не имеет RoomEvent.RoomStateChanged, используем прямое чтение room.state
    // и события Reconnecting/Reconnected/Disconnected

    // Обработчики событий переподключения
    const handleReconnecting = () => {
      if (cancelled) return
      console.warn('[useRoom] Room reconnecting...', { tokenHash: hashToken(token) })
      setConnectionState(ConnectionState.Reconnecting)
      setIsConnected(false)
      // ВАЖНО: НЕ вызываем room.disconnect() здесь!
    }

    const handleReconnected = () => {
      if (cancelled) return
      console.info('[useRoom] Room reconnected', { tokenHash: hashToken(token) })
      setConnectionState(ConnectionState.Connected)
      setIsConnected(true)
      setError(null)
      // ВАЖНО: НЕ вызываем room.disconnect() здесь!
    }

    const handleDisconnected = () => {
      if (cancelled) return
      console.warn('[useRoom] Room disconnected', { tokenHash: hashToken(token) })
      setConnectionState(ConnectionState.Disconnected)
      setIsConnected(false)
      // ВАЖНО: НЕ вызываем room.disconnect() здесь!
    }

    // Подписываемся на события ДО подключения
    newRoom.on(RoomEvent.Reconnecting, handleReconnecting)
    newRoom.on(RoomEvent.Reconnected, handleReconnected)
    newRoom.on(RoomEvent.Disconnected, handleDisconnected)

    // Запускаем подключение
    connect()

    return () => {
      cancelled = true
      
      console.info('[useRoom] Cleanup, disconnecting room', {
        tokenHash: hashToken(token),
        roomState: newRoom.state,
      })

      // Отписываемся от событий
      newRoom.off(RoomEvent.Reconnecting, handleReconnecting)
      newRoom.off(RoomEvent.Reconnected, handleReconnected)
      newRoom.off(RoomEvent.Disconnected, handleDisconnected)

      // ВАЖНО: disconnect здесь вызываем только когда компонент реально уходит
      // или когда token/serverUrl поменялись и мы уже создали новый Room
      try {
        newRoom.disconnect()
      } catch (e) {
        console.warn('[useRoom] Error disconnecting room on cleanup', e)
      } finally {
        if (roomRef.current === newRoom) {
          roomRef.current = null
        }
        setIsConnected(false)
        setRoom((current) => (current === newRoom ? null : current))
        setConnectionState(ConnectionState.Disconnected)
      }
    }
  }, [token, serverUrl])

  return { room, isConnected, connectionState, error }
}


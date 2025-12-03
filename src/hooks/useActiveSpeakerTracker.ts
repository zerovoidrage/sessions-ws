/**
 * Хук для отслеживания активного спикера и отправки событий на сервер.
 * 
 * Используется для идентификации спикеров в серверной транскрипции.
 */

import { useEffect, useRef } from 'react'
import { Room, LocalParticipant, RemoteParticipant, RoomEvent } from 'livekit-client'

interface UseActiveSpeakerTrackerOptions {
  room: Room | null
  localParticipant: LocalParticipant | null
  remoteParticipants: RemoteParticipant[]
  sessionSlug: string
  transcriptionToken?: string
}

/**
 * Отслеживает активного спикера и отправляет события на сервер через HTTP.
 * 
 * Использует HTTP POST запросы вместо WebSocket для лучшей совместимости с Railway.
 */
export function useActiveSpeakerTracker({
  room,
  localParticipant,
  remoteParticipants,
  sessionSlug,
  transcriptionToken,
}: UseActiveSpeakerTrackerOptions): void {
  const lastActiveSpeakerRef = useRef<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastSentTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!room || !sessionSlug || !transcriptionToken) {
      return
    }

    // Используем WS_SERVER_URL для HTTP API запросов
    // Для локальной разработки: http://localhost:3001
    // Для production: из NEXT_PUBLIC_WS_HOST или NEXT_PUBLIC_WS_SERVER_URL
    const wsHost = process.env.NEXT_PUBLIC_WS_HOST
    const wsServerUrl = process.env.NEXT_PUBLIC_WS_SERVER_URL || process.env.WS_SERVER_URL
    
    let apiBaseUrl = wsServerUrl
    
    if (!apiBaseUrl && wsHost) {
      // Если есть NEXT_PUBLIC_WS_HOST, формируем URL
      const cleanHost = wsHost.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const isRemoteHost = cleanHost !== 'localhost' && !cleanHost.startsWith('127.0.0.1') && !cleanHost.startsWith('192.168.')
      const protocol = isRemoteHost ? 'https' : 'http'
      apiBaseUrl = `${protocol}://${cleanHost}`
    }
    
    if (!apiBaseUrl) {
      // Fallback
      apiBaseUrl = typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? 'https://ws-production-dbcc.up.railway.app'
        : 'http://localhost:3001'
    }

    // Функция для определения текущего активного спикера
    const getActiveSpeaker = (): { identity: string; name?: string } | null => {
      const allParticipants = [
        ...(localParticipant ? [{ participant: localParticipant, isLocal: true }] : []),
        ...remoteParticipants.map((p) => ({ participant: p, isLocal: false })),
      ]

      // Находим участника с isSpeaking === true
      for (const { participant, isLocal } of allParticipants) {
        if (participant.isSpeaking) {
          return {
            identity: participant.identity,
            name: participant.name || participant.identity,
          }
        }
      }

      return null
    }

    // Функция для отправки active speaker event через HTTP
    const sendActiveSpeakerEvent = async (identity: string, name?: string) => {
      if (!transcriptionToken) {
        return
      }

      // Дебаунс: не отправляем события чаще, чем раз в 500ms
      const now = Date.now()
      if (now - lastSentTimeRef.current < 500) {
        return
      }
      lastSentTimeRef.current = now

      try {
        const response = await fetch(`${apiBaseUrl}/api/active-speaker`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionSlug,
            identity,
            name,
            timestamp: now,
            token: transcriptionToken,
          }),
        })

        if (!response.ok) {
          console.error('[ActiveSpeakerTracker] Failed to send active speaker event:', response.status, response.statusText)
        }
      } catch (error) {
        console.error('[ActiveSpeakerTracker] Failed to send active speaker event:', error)
      }
    }

    // Проверяем активного спикера каждые 200ms
    checkIntervalRef.current = setInterval(() => {
      const activeSpeaker = getActiveSpeaker()
      
      if (activeSpeaker) {
        // Отправляем событие только если спикер изменился
        if (lastActiveSpeakerRef.current !== activeSpeaker.identity) {
          lastActiveSpeakerRef.current = activeSpeaker.identity
          sendActiveSpeakerEvent(activeSpeaker.identity, activeSpeaker.name)
        }
      } else {
        // Если никто не говорит, сбрасываем активного спикера
        if (lastActiveSpeakerRef.current !== null) {
          lastActiveSpeakerRef.current = null
        }
      }
    }, 200) // Проверяем каждые 200ms

    // Подписываемся на события изменения участников
    const handleParticipantConnected = () => {
      // При подключении нового участника проверяем активного спикера
    }

    const handleParticipantDisconnected = () => {
      // При отключении участника проверяем активного спикера
    }

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
      
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      // HTTP не требует закрытия соединения
    }
  }, [room, localParticipant, remoteParticipants, sessionSlug, transcriptionToken])
}


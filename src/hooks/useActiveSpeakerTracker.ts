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
 * Отслеживает активного спикера и отправляет события на WebSocket сервер.
 */
export function useActiveSpeakerTracker({
  room,
  localParticipant,
  remoteParticipants,
  sessionSlug,
  transcriptionToken,
}: UseActiveSpeakerTrackerOptions): void {
  const wsRef = useRef<WebSocket | null>(null)
  const lastActiveSpeakerRef = useRef<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!room || !sessionSlug || !transcriptionToken) {
      return
    }

    // Подключаемся к WebSocket серверу для отправки active speaker events
    const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
    const wsProtocol = wsHost.includes('localhost') || wsHost.includes('127.0.0.1') ? 'ws' : 'wss'
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT
    const isProduction = wsProtocol === 'wss'
    // Для Railway production: порт не указываем (проксируется на стандартный 443)
    // Для dev или если порт явно указан: используем указанный порт или 3001
    const portSuffix = wsPort && wsPort !== '' ? `:${wsPort}` : (isProduction ? '' : ':3001')
    const wsUrl = `${wsProtocol}://${wsHost}${portSuffix}/api/realtime/transcribe?token=${encodeURIComponent(transcriptionToken)}`

    let ws: WebSocket | null = null

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('[ActiveSpeakerTracker] WebSocket connected for active speaker tracking')
        }

        ws.onerror = (error) => {
          console.error('[ActiveSpeakerTracker] WebSocket error:', error)
        }

        ws.onclose = () => {
          console.log('[ActiveSpeakerTracker] WebSocket closed')
          wsRef.current = null
          // Переподключаемся через 2 секунды
          setTimeout(connect, 2000)
        }
      } catch (error) {
        console.error('[ActiveSpeakerTracker] Failed to connect:', error)
      }
    }

    connect()

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

    // Функция для отправки active speaker event
    const sendActiveSpeakerEvent = (identity: string, name?: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'active_speaker',
            identity,
            name,
            timestamp: Date.now(),
          }))
        } catch (error) {
          console.error('[ActiveSpeakerTracker] Failed to send active speaker event:', error)
        }
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
      
      if (ws) {
        ws.close()
        wsRef.current = null
      }
    }
  }, [room, localParticipant, remoteParticipants, sessionSlug, transcriptionToken])
}


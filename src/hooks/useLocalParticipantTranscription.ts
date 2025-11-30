// src/hooks/useLocalParticipantTranscription.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, LocalParticipant } from 'livekit-client'

interface UseLocalParticipantTranscriptionOptions {
  roomSlug: string
  room?: Room | null
  localParticipant?: LocalParticipant | null
}

export function useLocalParticipantTranscription({
  roomSlug,
  room,
  localParticipant,
}: UseLocalParticipantTranscriptionOptions) {
  const [isActive, setIsActive] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const wsReadyRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const isMountedRef = useRef(true)

  const onTranscriptCallbackRef = useRef<((message: any) => void) | null>(null)

  // Функция для обработки транскриптов от сервера
  const sendTranscriptFromServer = useCallback(
    ({
      text,
      isFinal,
      utteranceId = null,
    }: {
      text: string
      isFinal: boolean
      utteranceId?: string | null
    }) => {
      if (!room || !localParticipant || !text.trim()) {
        return
      }

      if (!text?.trim()) {
        return
      }

      const timestamp = Date.now()
      const payload = {
        type: 'transcript' as const,
        id: '',
        speakerId: localParticipant.identity,
        speakerName: localParticipant.name ?? localParticipant.identity,
        text: text.trim(),
        isFinal,
        ts: timestamp,
        utterance_id: utteranceId || null,
      }

      const encoded = new TextEncoder().encode(JSON.stringify(payload))

      if (onTranscriptCallbackRef.current) {
        onTranscriptCallbackRef.current({
          id: '',
          roomSlug,
          speakerId: localParticipant.identity,
          speakerName: localParticipant.name ?? localParticipant.identity,
          text: text.trim(),
          isFinal,
          timestamp,
          utteranceId: utteranceId || null,
        })
      }

      try {
        localParticipant.publishData(encoded, {
          reliable: true,
        })
      } catch (e) {
        console.error('[Transcription] Failed to publish data', e)
      }
    },
    [room, localParticipant, roomSlug, onTranscriptCallbackRef],
  )

  // Инициализация транскрипции
  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Запуск транскрипции
  useEffect(() => {
    console.log('[Transcription] useEffect triggered', {
      isActive,
      hasRoom: !!room,
      hasLocalParticipant: !!localParticipant,
      roomState: room?.state,
    })

    if (!isActive) {
      console.log('[Transcription] Not active, skipping')
      return
    }

    if (!room || !localParticipant) {
      console.log('[Transcription] Missing room or localParticipant')
      return
    }

    if (room.state !== 'connected') {
      console.log('[Transcription] Room not connected, state:', room.state)
      return
    }

    const startTranscription = async () => {
      try {
        // Получаем аудио трек от LiveKit
        // Ждем, пока трек будет доступен
        let audioTrack = null
        let attempts = 0
        const maxAttempts = 30 // Увеличиваем до 30 попыток (6 секунд)

        while (!audioTrack && attempts < maxAttempts) {
          // Используем правильный API LiveKit для получения микрофона
          const micPublication = localParticipant.getTrackPublication('microphone')
          
          if (micPublication && micPublication.track) {
            audioTrack = micPublication.track
            console.log('[Transcription] Found audio track', {
              trackId: audioTrack.trackId,
              kind: audioTrack.kind,
              isMuted: micPublication.isMuted,
            })
          } else {
            // Если трек еще не опубликован, попробуем включить микрофон
            if (attempts === 5) {
              console.log('[Transcription] Microphone not found, trying to enable...')
              try {
                await localParticipant.setMicrophoneEnabled(true)
              } catch (e) {
                console.warn('[Transcription] Failed to enable microphone:', e)
              }
            }
          }
          
          if (!audioTrack) {
            await new Promise(resolve => setTimeout(resolve, 200))
            attempts++
          }
        }

        if (!audioTrack) {
          console.error('[Transcription] Audio track not available after waiting', {
            attempts,
            hasMicPublication: !!localParticipant.getTrackPublication('microphone'),
            micPublication: localParticipant.getTrackPublication('microphone'),
          })
          return
        }

        console.log('[Transcription] Audio track found', {
          trackId: audioTrack.trackId,
          kind: audioTrack.kind,
        })

        // Получаем MediaStreamTrack из трека
        const mediaStreamTrack = audioTrack.mediaStreamTrack
        if (!mediaStreamTrack) {
          console.warn('[Transcription] MediaStreamTrack not found', {
            trackId: audioTrack.trackId,
            hasTrack: !!audioTrack,
          })
          return
        }

        console.log('[Transcription] MediaStreamTrack found', {
          id: mediaStreamTrack.id,
          kind: mediaStreamTrack.kind,
          enabled: mediaStreamTrack.enabled,
          muted: mediaStreamTrack.muted,
        })

        // Создаем MediaStream из трека
        const mediaStream = new MediaStream([mediaStreamTrack])
        mediaStreamRef.current = mediaStream

        // Создаем AudioContext с нужной sample rate для Gladia (16kHz)
        const targetSampleRate = 16000
        const audioContext = new AudioContext({
          sampleRate: targetSampleRate,
        })
        audioContextRef.current = audioContext

        // Создаем источник из MediaStream
        const source = audioContext.createMediaStreamSource(mediaStream)
        sourceRef.current = source

        // Создаем ScriptProcessorNode для обработки аудио
        const bufferSize = 4096
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)
        processorRef.current = processor

        // Подключаем к WebSocket серверу
        const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '3001'
        const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
        const wsUrl = `ws://${wsHost}:${wsPort}/api/realtime/transcribe`

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          wsReadyRef.current = true
          console.log('[Transcription] WebSocket connected to Gladia server')
        }

        ws.onerror = (error) => {
          console.error('[Transcription] WebSocket error:', error)
          wsReadyRef.current = false
        }

        ws.onclose = () => {
          wsReadyRef.current = false
          console.log('[Transcription] WebSocket closed')
        }

        // Обработка сообщений от сервера
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            if (data.type === 'transcription' && data.text?.trim() && isMountedRef.current) {
              sendTranscriptFromServer({
                text: data.text,
                isFinal: Boolean(data.is_final),
                utteranceId: data.utterance_id || data.utteranceId || null,
              })
            } else if (data.type === 'error') {
              console.error('[Transcription] Server error:', data.message || data)
            }
          } catch (error) {
            console.error('[Transcription] Error parsing server message:', error)
          }
        }

        // Обработка аудио данных
        let audioChunkCount = 0
        processor.onaudioprocess = (event) => {
          if (!wsReadyRef.current || ws.readyState !== WebSocket.OPEN) {
            if (audioChunkCount === 0) {
              console.warn('[Transcription] WebSocket not ready, skipping audio', {
                wsReady: wsReadyRef.current,
                wsState: ws.readyState,
              })
            }
            return
          }

          const inputData = event.inputBuffer.getChannelData(0)
          
          // Конвертируем Float32Array в Int16Array (PCM16)
          const pcm16 = new Int16Array(inputData.length)
          for (let i = 0; i < inputData.length; i++) {
            // Ограничиваем значение в диапазоне [-1, 1] и конвертируем в 16-bit
            const s = Math.max(-1, Math.min(1, inputData[i]))
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
          }

          // Отправляем аудио данные на сервер
          try {
            ws.send(pcm16.buffer)
            audioChunkCount++
            if (audioChunkCount === 1 || audioChunkCount % 100 === 0) {
              console.log('[Transcription] Audio chunk sent', {
                chunkNumber: audioChunkCount,
                bufferSize: pcm16.length,
              })
            }
          } catch (error) {
            console.error('[Transcription] Error sending audio:', error)
          }
        }

        // Подключаем процессор к источнику
        source.connect(processor)
        processor.connect(audioContext.destination)

        console.log('[Transcription] Transcription started')
      } catch (error) {
        console.error('[Transcription] Failed to start transcription:', error)
      }
    }

    startTranscription()

    return () => {
      // Очистка при размонтировании
      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current = null
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect()
        sourceRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      wsReadyRef.current = false
    }
  }, [isActive, room, localParticipant, sendTranscriptFromServer])

  return {
    isActive,
    start: () => {
      setIsActive(true)
    },
    stop: () => {
      setIsActive(false)
    },
    sendTranscriptFromServer,
    setOnTranscriptCallback: (callback: ((message: any) => void) | null) => {
      onTranscriptCallbackRef.current = callback
    },
  }
}


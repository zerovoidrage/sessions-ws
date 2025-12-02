// src/hooks/useLocalParticipantTranscription.ts
'use client'

/**
 * ВАЖНО: Клиентская транскрипция отключена в пользу серверной.
 * 
 * Теперь транскрипция происходит на сервере:
 * - Серверный транскрайбер подключается к LiveKit комнате при переходе сессии в статус LIVE
 * - Подписывается на все аудио треки участников
 * - Микширует аудио и отправляет в Gladia
 * - Публикует транскрипты через LiveKit data channel
 * 
 * Этот хук оставлен для обратной совместимости, но больше не захватывает микрофон
 * и не отправляет аудио на WebSocket сервер.
 * 
 * Транскрипты по-прежнему приходят через LiveKit data channel и обрабатываются
 * в useTranscriptStream.ts.
 * 
 * Функции start() и stop() теперь no-op - они не запускают реальную транскрипцию.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, LocalParticipant, Track, ConnectionState } from 'livekit-client'
import { connectTranscriptionWebSocket } from './utils/connectTranscriptionWebSocket'
import type { TranscriptMessage } from '@/types/transcript'
import { clientTranscriptionMetrics } from '@/modules/core/sessions/infra/transcription/transcription-metrics'
import {
  isTranscriptionEnabledForSession,
  canStartTranscriptionForSession,
} from '@/modules/core/sessions/infra/transcription/transcription-flags'

// Флаг для отключения клиентской транскрипции (серверная транскрипция включена)
const SERVER_TRANSCRIPTION_ENABLED = true

interface UseLocalParticipantTranscriptionOptions {
  sessionSlug: string
  room?: Room | null
  localParticipant?: LocalParticipant | null
  connectionState?: ConnectionState
  transcriptionToken?: string // JWT токен для авторизации WebSocket транскрипции
  isTranscriptionHost?: boolean // true = этот участник является designated host и должен запускать транскрипцию
  userId?: string // ID пользователя для учёта использования
}

export function useLocalParticipantTranscription({
  sessionSlug,
  room,
  localParticipant,
  connectionState = ConnectionState.Disconnected,
  transcriptionToken,
  isTranscriptionHost = false, // По умолчанию не host
  userId, // ID пользователя для учёта использования
}: UseLocalParticipantTranscriptionOptions) {
  const [isActive, setIsActive] = useState(false)
  const transcriptionStartedAtRef = useRef<Date | null>(null) // Время начала транскрипции

  const wsRef = useRef<WebSocket | null>(null)
  const wsReadyRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null) // Заменяет ScriptProcessorNode
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaStreamTrackRef = useRef<MediaStreamTrack | null>(null)
  const isMountedRef = useRef(true)
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Для retry при закрытии WebSocket
  const audioChunkCountRef = useRef(0) // Счетчик отправленных аудио-чанков
  const lastStartAttemptRef = useRef<number>(0) // Время последней попытки запуска (защита от частых перезапусков)
  const isStartingRef = useRef(false) // Флаг, что транскрипция запускается
  const localParticipantRef = useRef<LocalParticipant | null>(null)
  const transcriptionTokenRef = useRef<string | undefined>(transcriptionToken) // Сохраняем transcriptionToken для переподключения
  const isTranscriptionHostRef = useRef<boolean>(isTranscriptionHost) // Сохраняем флаг host для переподключения

  const onTranscriptCallbackRef = useRef<((message: TranscriptMessage) => void) | null>(null)

  // Синхронизируем refs при изменении
  useEffect(() => {
    localParticipantRef.current = localParticipant || null
    transcriptionTokenRef.current = transcriptionToken
    isTranscriptionHostRef.current = isTranscriptionHost
  }, [localParticipant, transcriptionToken, isTranscriptionHost])

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

      // Проверяем, что комната подключена и соединение активно
      if (room.state !== ConnectionState.Connected) {
        console.warn('[Transcription] Room is not connected, skipping data publish', {
          roomState: room.state,
        })
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

      console.log('[Transcription] 📤 sendTranscriptFromServer called', {
        text: text.substring(0, 100),
        isFinal,
        utteranceId,
        hasCallback: !!onTranscriptCallbackRef.current,
        roomState: room.state,
        hasLocalParticipant: !!localParticipant,
      })

      if (onTranscriptCallbackRef.current) {
        try {
          onTranscriptCallbackRef.current({
            id: '',
            sessionSlug,
            speakerId: localParticipant.identity,
            speakerName: localParticipant.name ?? localParticipant.identity,
            text: text.trim(),
            isFinal,
            timestamp,
            utteranceId: utteranceId || null,
          })
          console.log('[Transcription] ✅ onTranscriptCallback executed successfully')
        } catch (error) {
          console.error('[Transcription] ❌ Error in onTranscriptCallback:', error)
        }
      } else {
        console.warn('[Transcription] ⚠️ No onTranscriptCallback set!')
      }

      try {
        // Дополнительная проверка перед отправкой
        if (room.state === ConnectionState.Connected && localParticipant) {
          localParticipant.publishData(encoded, {
            reliable: true,
          })
          console.log('[Transcription] ✅ Data published to LiveKit room', {
            text: text.substring(0, 50),
            isFinal,
            speakerId: localParticipant.identity,
            speakerName: localParticipant.name,
            roomState: room.state,
            participantCount: 1 + (room.remoteParticipants?.size || 0),
          })
        } else {
          console.warn('[Transcription] Cannot publish data: room not connected or participant unavailable', {
            roomState: room.state,
            hasLocalParticipant: !!localParticipant,
          })
        }
      } catch (e) {
        console.error('[Transcription] Failed to publish data', e)
        // Не пробрасываем ошибку дальше, чтобы не ломать транскрипцию
      }
    },
    [room, localParticipant, sessionSlug, onTranscriptCallbackRef],
  )

  // Инициализация транскрипции
  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Функция для остановки транскрипции (мягкая очистка)
  const stopTranscription = useCallback(async () => {
    console.log('[Transcription] Stopping transcription...')
    
    // Сохраняем метрики использования перед остановкой
    if (transcriptionStartedAtRef.current && localParticipant) {
      const participantIdentity = localParticipant.identity
      const metrics = clientTranscriptionMetrics.getMetrics(sessionSlug, participantIdentity)
      
      if (metrics && !metrics.endedAt) {
        // Завершаем сессию метрик
        const finalMetrics = clientTranscriptionMetrics.endSession(sessionSlug, participantIdentity)
        
        if (finalMetrics) {
          // Сохраняем использование в БД через API
          try {
            await fetch('/api/transcription/usage/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionSlug,
                participantIdentity,
                userId,
                startedAt: finalMetrics.startedAt.toISOString(),
                endedAt: finalMetrics.endedAt?.toISOString(),
                durationSeconds: finalMetrics.totalDurationSeconds,
                durationMinutes: finalMetrics.totalTranscriptionMinutes,
                audioChunksSent: finalMetrics.totalAudioChunksSent,
                transcriptsReceived: finalMetrics.totalTranscriptsReceived,
                finalTranscripts: finalMetrics.totalFinalTranscripts,
                partialTranscripts: finalMetrics.totalPartialTranscripts,
                errorsCount: finalMetrics.errors.length,
              }),
            })
            console.log('[Transcription] Usage saved to DB', {
              durationMinutes: finalMetrics.totalTranscriptionMinutes,
            })
          } catch (error) {
            console.error('[Transcription] Failed to save usage:', error)
          }
        }
      }
    }
    
    transcriptionStartedAtRef.current = null
    
    // Очищаем timeout переподключения, если он есть
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current)
      wsReconnectTimeoutRef.current = null
    }
    
    // Закрываем WebSocket
    if (wsRef.current) {
      try {
        // Закрываем с кодом 1000 (нормальное закрытие), чтобы не триггерить переподключение
        wsRef.current.close(1000, 'Transcription stopped')
      } catch (e) {
        console.warn('[Transcription] Error closing WebSocket:', e)
      }
      wsRef.current = null
    }
    wsReadyRef.current = false

    // Отключаем AudioWorkletNode
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect()
        workletNodeRef.current.port.close() // Закрываем порт для сообщений
      } catch (e) {
        console.warn('[Transcription] Error disconnecting worklet node:', e)
      }
      workletNodeRef.current = null
    }

    // Отключаем источник
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (e) {
        console.warn('[Transcription] Error disconnecting source:', e)
      }
      sourceRef.current = null
    }

    // Закрываем AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close()
      } catch (e) {
        console.warn('[Transcription] Error closing AudioContext:', e)
      }
      audioContextRef.current = null
    }

    // Очищаем MediaStream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    // Очищаем ref на MediaStreamTrack
    mediaStreamTrackRef.current = null
    localParticipantRef.current = null

    console.log('[Transcription] Transcription stopped')
  }, [])

  // Отслеживание состояния микрофона и обновление mediaStreamTrackRef при изменении трека
  useEffect(() => {
    if (!localParticipant) return

    const updateMediaStreamTrackRef = () => {
      const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
      if (micPublication && micPublication.track) {
        const audioTrack = micPublication.track
        const mediaStreamTrack = (audioTrack as any).mediaStreamTrack as MediaStreamTrack | undefined
        if (mediaStreamTrack) {
          // Всегда обновляем ref, даже если это тот же трек - его свойства могли измениться
          const wasDifferent = mediaStreamTrackRef.current !== mediaStreamTrack
          const oldTrackId = mediaStreamTrackRef.current?.id
          mediaStreamTrackRef.current = mediaStreamTrack
          
          if (wasDifferent) {
            console.log('[Transcription] MediaStreamTrack updated', {
              oldTrackId,
              newTrackId: mediaStreamTrack.id,
              enabled: mediaStreamTrack.enabled,
              muted: mediaStreamTrack.muted,
              readyState: mediaStreamTrack.readyState,
              isMuted: micPublication.isMuted,
            })
            
            // Если трек действительно изменился И пайплайн уже запущен - пересоздаем MediaStream
            if (oldTrackId && oldTrackId !== mediaStreamTrack.id && audioContextRef.current && sourceRef.current) {
              console.log('[Transcription] Track changed, recreating MediaStream and reconnecting source')
              
              try {
                const audioContext = audioContextRef.current
                const workletNode = workletNodeRef.current
                
                // Отключаем старый source от worklet
                if (workletNode) {
                  sourceRef.current.disconnect()
                }
                
                // Удаляем старый MediaStream
                if (mediaStreamRef.current) {
                  mediaStreamRef.current.getTracks().forEach(track => track.stop())
                  mediaStreamRef.current = null
                }
                
                // Создаем новый MediaStream из нового трека
                const newMediaStream = new MediaStream([mediaStreamTrack])
                mediaStreamRef.current = newMediaStream
                
                // Создаем новый source из нового MediaStream
                const newSource = audioContext.createMediaStreamSource(newMediaStream)
                sourceRef.current = newSource
                
                // Подключаем новый source к worklet
                if (workletNode) {
                  newSource.connect(workletNode)
                  console.log('[Transcription] MediaStream and source recreated and reconnected')
                }
              } catch (error) {
                console.error('[Transcription] Failed to recreate MediaStream:', error)
              }
            }
          }
        } else {
          console.warn('[Transcription] No mediaStreamTrack found in audioTrack', {
            hasAudioTrack: !!audioTrack,
            isMuted: micPublication.isMuted,
          })
        }
      } else {
        console.warn('[Transcription] No micPublication or track found when updating ref', {
          hasMicPublication: !!micPublication,
          hasTrack: !!micPublication?.track,
          isMuted: micPublication?.isMuted,
        })
      }
    }

    const handleTrackMuted = () => {
      const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
      console.log('[Transcription] Microphone track muted event - audio will be gated in convertAndSendAudio', {
        isMuted: micPublication?.isMuted,
        hasTrack: !!micPublication?.track,
      })
      // Обновляем ref сразу, чтобы convertAndSendAudio видел актуальное состояние
      updateMediaStreamTrackRef()
      // Сбрасываем счетчик, чтобы логирование "Audio gated" работало корректно
      audioChunkCountRef.current = 0
    }

    const handleTrackUnmuted = () => {
      const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
      console.log('[Transcription] Microphone track unmuted event - audio will flow again', {
        isMuted: micPublication?.isMuted,
        hasTrack: !!micPublication?.track,
      })
      // Обновляем ref сразу, чтобы convertAndSendAudio видел актуальное состояние
      updateMediaStreamTrackRef()
      // Сбрасываем счетчик, чтобы логирование работало корректно
      audioChunkCountRef.current = 0
    }

    const handleTrackPublished = () => {
      console.log('[Transcription] Microphone track published event')
      updateMediaStreamTrackRef()
    }

    const handleTrackUnpublished = () => {
      console.log('[Transcription] Microphone track unpublished event')
      // Не обнуляем ref при unpublish - трек может быть еще доступен
    }

    // Обновляем сразу
    updateMediaStreamTrackRef()

    localParticipant.on('trackMuted', handleTrackMuted)
    localParticipant.on('trackUnmuted', handleTrackUnmuted)
    localParticipant.on('trackPublished', handleTrackPublished)
    localParticipant.on('trackUnpublished', handleTrackUnpublished)

    return () => {
      localParticipant.off('trackMuted', handleTrackMuted)
      localParticipant.off('trackUnmuted', handleTrackUnmuted)
      localParticipant.off('trackPublished', handleTrackPublished)
      localParticipant.off('trackUnpublished', handleTrackUnpublished)
    }
  }, [localParticipant])

  // Запуск транскрипции
  useEffect(() => {
    // Проверяем состояние микрофона
    // Блокируем запуск только если трек существует И явно выключен (isMuted === true)
    // Если трека нет - разрешаем запуск (трек появится при включении микрофона)
    const micPublication = localParticipant?.getTrackPublication(Track.Source.Microphone)
    const isMicMuted = micPublication && micPublication.track && micPublication.isMuted

    console.log('[Transcription] useEffect triggered', {
      isActive,
      isTranscriptionHost,
      hasRoom: !!room,
      hasLocalParticipant: !!localParticipant,
      connectionState,
      isMicMuted,
      hasMicPublication: !!micPublication,
      hasMicTrack: micPublication && !!micPublication.track,
    })

    // Проверяем feature flags
    if (!isTranscriptionEnabledForSession(sessionSlug)) {
      console.log('[Transcription] Transcription disabled for session', { sessionSlug })
      if (wsRef.current || audioContextRef.current) {
        stopTranscription()
      }
      return
    }

    // Проверяем ограничения по количеству активных транскрипций
    // TODO: Реализовать проверку через API или локальное состояние
    // Пока пропускаем - проверка будет реализована на уровне сервера при сохранении использования

    // ВАЖНО: Транскрипция запускается для КАЖДОГО участника
    // Каждый участник транскрибирует свой собственный голос
    // Транскрипты отправляются через LiveKit data channel для всех участников

    // Определяем, должна ли транскрипция быть активна
    // При Reconnecting НЕ останавливаем транскрипцию - она может продолжать работать
    // Останавливаем только при Disconnected или если транскрипция выключена (isActive === false)
    // Mute микрофона НЕ останавливает пайплайн - он только блокирует отправку аудио через convertAndSendAudio
    // НЕ требуем hasMicTrack - трек может появиться позже, когда микрофон включится
    const shouldBeActive = isActive && 
      (connectionState === ConnectionState.Connected || connectionState === ConnectionState.Reconnecting) && 
      !!room && 
      !!localParticipant
    // НЕ проверяем isMicMuted здесь - mute блокирует только отправку аудио, не останавливает пайплайн

    // Останавливаем транскрипцию только если пользователь выключил её (isActive === false) или disconnected
    // НЕ останавливаем из-за mute - mute только блокирует поток аудио
    if (!shouldBeActive) {
      if (wsRef.current || audioContextRef.current) {
        console.log('[Transcription] Stopping transcription due to state change', {
          isActive,
          connectionState,
          hasRoom: !!room,
          hasLocalParticipant: !!localParticipant,
          isMicMuted,
          hasMicPublication: !!micPublication,
        })
        stopTranscription()
      }
      return
    }

    // Блокируем ЗАПУСК транскрипции если микрофон явно выключен (но не останавливаем уже запущенную)
    if (isMicMuted && !wsRef.current && !audioContextRef.current) {
      console.log('[Transcription] Microphone is muted, not starting transcription pipeline', {
        hasMicPublication: !!micPublication,
        hasTrack: micPublication ? !!micPublication.track : false,
      })
      return
    }

    // Если состояние Reconnecting, но транскрипция уже запущена - продолжаем работу
    // WebSocket может продолжать работать даже при временных проблемах с LiveKit
    // Mute микрофона не влияет - пайплайн продолжает работать
    if (connectionState === ConnectionState.Reconnecting) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && audioContextRef.current) {
        console.log('[Transcription] Room reconnecting, but transcription continues', {
          wsState: wsRef.current.readyState,
          hasAudioContext: !!audioContextRef.current,
          isMicMuted,
        })
        // Не останавливаем транскрипцию - она может продолжать работать
        return
      }
    }

    // Если транскрипция должна быть активна, но уже запущена и WebSocket открыт, ничего не делаем
    // Mute микрофона не влияет - пайплайн продолжает работать, просто не отправляет аудио
    // ВАЖНО: Проверяем наличие всех компонентов пайплайна, чтобы не перезапускать при изменении localParticipant
    // или при подключении других участников
    const isAlreadyRunning = (
      audioContextRef.current &&
      workletNodeRef.current &&
      sourceRef.current &&
      mediaStreamRef.current
    )
    
    // Если пайплайн уже запущен, не перезапускаем его
    // WebSocket может переподключаться, но это обрабатывается отдельно в onclose handler
    if (isAlreadyRunning && shouldBeActive) {
      // Проверяем WebSocket - если он закрыт, но пайплайн работает, WebSocket переподключится автоматически
      const wsNeedsReconnect = !wsRef.current || 
        (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)
      
      if (!wsNeedsReconnect) {
        console.log('[Transcription] Already running, skipping restart', {
          isMicMuted,
          wsState: wsRef.current?.readyState,
          hasAudioContext: !!audioContextRef.current,
          hasWorklet: !!workletNodeRef.current,
          hasSource: !!sourceRef.current,
          connectionState,
        })
        // Не перезапускаем, даже если localParticipant изменился (например, при подключении других участников)
        return
      } else {
        console.log('[Transcription] Pipeline running but WebSocket needs reconnection, will reconnect separately', {
          wsState: wsRef.current?.readyState,
          hasAudioContext: !!audioContextRef.current,
        })
        // WebSocket переподключится через отдельную логику, не перезапускаем весь пайплайн
        return
      }
    }

    const startTranscription = async () => {
      // Защита от частых перезапусков (минимум 2 секунды между попытками)
      const now = Date.now()
      if (isStartingRef.current || (lastStartAttemptRef.current > 0 && now - lastStartAttemptRef.current < 2000)) {
        console.log('[Transcription] Skipping start - too soon after last attempt', {
          isStarting: isStartingRef.current,
          timeSinceLastAttempt: lastStartAttemptRef.current > 0 ? now - lastStartAttemptRef.current : 0,
        })
        return
      }

      isStartingRef.current = true
      lastStartAttemptRef.current = now

      try {
        // Получаем аудио трек от LiveKit
        // Ждем, пока трек будет доступен
        let audioTrack = null
        let attempts = 0
        const maxAttempts = 30 // Увеличиваем до 30 попыток (6 секунд)

        while (!audioTrack && attempts < maxAttempts) {
          // Используем правильный API LiveKit для получения микрофона
          const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone)
          
          // Позволяем запустить пайплайн даже если микрофон muted
          // Mute будет блокировать отправку аудио через convertAndSendAudio
          if (micPublication && micPublication.track) {
            audioTrack = micPublication.track
            console.log('[Transcription] Found audio track', {
              trackSid: audioTrack.sid,
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
            hasMicPublication: !!localParticipant.getTrackPublication(Track.Source.Microphone),
            micPublication: localParticipant.getTrackPublication(Track.Source.Microphone),
          })
          isStartingRef.current = false
          return
        }

        console.log('[Transcription] Audio track found', {
          trackSid: audioTrack.sid,
          kind: audioTrack.kind,
        })

        // Получаем MediaStreamTrack из трека
        const mediaStreamTrack = (audioTrack as any).mediaStreamTrack as MediaStreamTrack | undefined

        if (!mediaStreamTrack) {
          console.error('[Transcription] No mediaStreamTrack on audioTrack')
          isStartingRef.current = false
          return
        }

        // Сохраняем track в ref, чтобы уметь проверять mute на уровне браузера
        mediaStreamTrackRef.current = mediaStreamTrack

        console.log('[Transcription] MediaStreamTrack found', {
          id: mediaStreamTrack.id,
          kind: mediaStreamTrack.kind,
          enabled: mediaStreamTrack.enabled,
          muted: mediaStreamTrack.muted,
          readyState: mediaStreamTrack.readyState,
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

        // Проверяем и возобновляем AudioContext если он suspended (Chrome autoplay policy)
        const resumeAudioContext = async () => {
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume()
              console.log('[Transcription] AudioContext resumed')
            } catch (error) {
              console.error('[Transcription] Failed to resume AudioContext:', error)
            }
          }
        }

        // Также возобновляем при пользовательском жесте (клик, тач и т.д.)
        const handleUserInteraction = () => {
          resumeAudioContext()
        }
        
        // Пытаемся возобновить сразу
        resumeAudioContext()

        // Добавляем обработчики для возобновления при пользовательском жесте
        document.addEventListener('click', handleUserInteraction, { once: true })
        document.addEventListener('touchstart', handleUserInteraction, { once: true })
        
        // Сохраняем ссылку на обработчики для cleanup
        const cleanupUserInteraction = () => {
          document.removeEventListener('click', handleUserInteraction)
          document.removeEventListener('touchstart', handleUserInteraction)
        }

        // Создаем источник из MediaStream
        const source = audioContext.createMediaStreamSource(mediaStream)
        sourceRef.current = source

        // ПОДКЛЮЧАЕМ WEBSOCKET ПЕРВЫМ, чтобы он был готов к моменту, когда AudioWorklet начнет отправлять данные
        // Это исключает пропуск первых аудио-чанков
        if (!transcriptionToken) {
          console.error('[Transcription] Missing transcriptionToken, cannot connect to WebSocket')
          throw new Error('Transcription token is required')
        }
        
        // Определяем протокол и хост для WebSocket
        let wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
        wsHost = wsHost.replace(/^https?:\/\//, '').replace(/\/$/, '')
        
        const isProductionHost = wsHost !== 'localhost' && !wsHost.startsWith('127.0.0.1') && !wsHost.startsWith('192.168.')
        const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
        const isProduction = isProductionHost || isHttps
        const wsProtocol = isProduction ? 'wss' : 'ws'
        
        const wsPort = process.env.NEXT_PUBLIC_WS_PORT
        let portSuffix = ''
        // ВАЖНО: Если порт явно указан в переменной окружения, используем его даже для production
        // Это необходимо для Render и других платформ, где WebSocket сервер работает на нестандартном порту
        if (wsPort) {
          portSuffix = `:${wsPort}`
        } else if (!isProduction) {
          // Для dev окружения используем порт по умолчанию
          portSuffix = ':3001'
        }
        // Для production без явного порта - используем стандартный порт (443 для WSS, не указываем в URL)
        
        const wsUrl = `${wsProtocol}://${wsHost}${portSuffix}/api/realtime/transcribe?token=${encodeURIComponent(transcriptionToken)}`
        
        console.log('[Transcription] WebSocket URL constructed', {
          wsHost,
          wsProtocol,
          wsPort,
          portSuffix,
          isProduction,
          isProductionHost,
          isHttps,
          wsUrl: wsUrl.replace(/token=[^&]+/, 'token=***'),
        })

        // Подключаемся к WebSocket ДО создания AudioWorklet
        // ВАЖНО: Если серверная транскрипция включена, клиентская транскрипция отключена
        if (SERVER_TRANSCRIPTION_ENABLED) {
          console.log('[Transcription] Server transcription enabled, skipping client-side WebSocket connection')
          isStartingRef.current = false
          return // Не запускаем клиентскую транскрипцию
        }
        
        let ws: WebSocket
        try {
          ws = await connectTranscriptionWebSocket(wsUrl, {
            maxRetries: 5,
            baseDelayMs: 1000,
            timeoutMs: 10000,
          })
          wsRef.current = ws
          wsReadyRef.current = true
          console.log('[Transcription] ✅ WebSocket connected (before AudioWorklet creation)', {
            wsUrl: wsUrl.replace(/token=[^&]+/, 'token=***'),
            readyState: ws.readyState,
          })
        } catch (error) {
          console.error('[Transcription] Failed to connect WebSocket before AudioWorklet:', {
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            wsUrl: wsUrl.replace(/token=[^&]+/, 'token=***'),
            hasTranscriptionToken: !!transcriptionToken,
          })
          wsReadyRef.current = false
          wsRef.current = null
          throw error // Пробрасываем ошибку, так как без WebSocket транскрипция невозможна
        }

        // Функция для конвертации Float32Array в Int16Array (PCM16) и отправки в WebSocket
        // ВАЖНО: Не замыкаемся на localParticipant - используем только ref для актуального состояния
        const convertAndSendAudio = (float32Data: Float32Array) => {
          // 1) WebSocket должен быть готов
          const wsState = wsRef.current?.readyState
          if (!wsReadyRef.current || !wsRef.current || wsState !== WebSocket.OPEN) {
            // Логируем только один раз при первом пропуске, чтобы не спамить консоль
            if (audioChunkCountRef.current === 0) {
              console.log('[Transcription] Waiting for WebSocket connection...', {
                wsReady: wsReadyRef.current,
                hasWs: !!wsRef.current,
                wsState: wsState,
                wsStateName: wsState === WebSocket.CONNECTING ? 'CONNECTING' :
                            wsState === WebSocket.OPEN ? 'OPEN' :
                            wsState === WebSocket.CLOSING ? 'CLOSING' :
                            wsState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
              })
            }
            return
          }

          // 2) КРИТИЧНО: Проверяем состояние микрофона ПЕРЕД каждым чанком
          // ВСЕГДА используем актуальное значение из ref (которое обновляется через useEffect)
          const participant = localParticipantRef.current
            
          if (!participant) {
            return
          }
          
          const micPublication = participant.getTrackPublication(Track.Source.Microphone)
          
          // Если публикации нет, не отправляем аудио (трек еще не создан)
          if (!micPublication) {
            if (audioChunkCountRef.current === 0) {
              console.log('[Transcription] Audio chunk blocked: no micPublication', {
                hasParticipant: !!participant,
              })
            }
            return
          }
          
          // ГЛАВНАЯ ПРОВЕРКА: проверяем состояние микрофона через оба источника
          // 1. LiveKit TrackPublication.isMuted
          // 2. Браузерный MediaStreamTrack (enabled, muted, readyState)
          // Блокируем отправку если ЛЮБОЙ из источников указывает на mute
          // Это более безопасный подход: если хоть один источник говорит muted, не отправляем
          const hasTrack = !!micPublication.track
          const track = mediaStreamTrackRef.current
          
          // Проверка LiveKit: isMuted === true означает микрофон ВЫКЛЮЧЕН
          const liveKitMuted = micPublication.isMuted === true
          
          // Проверка MediaStreamTrack: трек должен быть enabled, не muted, и в состоянии 'live'
          // Если трек отсутствует, считаем его "не живым"
          const trackIsLive = track && 
            track.enabled === true && 
            track.muted === false && 
            track.readyState === 'live'
          
          // Блокируем отправку если LiveKit говорит muted ИЛИ трек не живой
          // Упрощенная логика: если любой источник говорит muted/не живой, блокируем
          const isMicrophoneMuted = liveKitMuted || !trackIsLive
          
          // Детальное логирование при первом вызове или при расхождении состояний
          if (audioChunkCountRef.current === 0 || (liveKitMuted && trackIsLive) || (!liveKitMuted && !trackIsLive)) {
            console.log('[Transcription] convertAndSendAudio check', {
              hasMicPublication: !!micPublication,
              liveKitIsMuted: micPublication.isMuted,
              hasTrack,
              trackSid: micPublication.trackSid || null,
              trackEnabled: track?.enabled,
              trackMuted: track?.muted,
              trackReadyState: track?.readyState,
              trackIsLive,
              isMicrophoneMuted,
              blockReason: liveKitMuted ? 'LiveKit says muted' : (!trackIsLive ? 'Track not live' : null),
            })
          }
          
          if (!hasTrack) {
            // Трека нет - не отправляем аудио
            if (audioChunkCountRef.current === 0) {
              console.log('[Transcription] Audio chunk blocked: no track in micPublication', {
                isMuted: micPublication.isMuted,
                hasPublication: !!micPublication,
                trackSid: micPublication.trackSid || null,
                trackEnabled: track?.enabled,
                trackMuted: track?.muted,
                trackReadyState: track?.readyState,
              })
            }
            return
          }
          
          if (isMicrophoneMuted) {
            // Логируем только иногда, чтобы не спамить консоль
            if (audioChunkCountRef.current === 0 || audioChunkCountRef.current % 100 === 0) {
              console.log('[Transcription] ❌ Audio chunk BLOCKED: microphone is muted', {
                liveKitIsMuted: micPublication.isMuted,
                hasTrack: !!micPublication.track,
                trackEnabled: track?.enabled,
                trackMuted: track?.muted,
                trackReadyState: track?.readyState,
                trackIsLive,
                blockReason: liveKitMuted ? 'LiveKit muted' : (!trackIsLive ? 'Track not live' : 'Unknown'),
                chunkCount: audioChunkCountRef.current,
              })
            }
            return
          }
          
          // Логируем первый успешный чанк после unmute (когда счетчик был сброшен)
          if (audioChunkCountRef.current === 0) {
            console.log('[Transcription] ✅ Audio chunk ALLOWED: microphone is unmuted', {
              isMuted: micPublication.isMuted,
              hasTrack: !!micPublication.track,
              trackEnabled: track?.enabled,
              trackMuted: track?.muted,
              trackReadyState: track?.readyState,
            })
          }


            // 3) Конвертируем Float32Array в Int16Array (PCM16)
            const pcm16 = new Int16Array(float32Data.length)
            for (let i = 0; i < float32Data.length; i++) {
              const s = Math.max(-1, Math.min(1, float32Data[i]))
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
            }

            // Отправляем аудио данные на сервер
            try {
              wsRef.current.send(pcm16.buffer)
              audioChunkCountRef.current++
              
              // Обновляем метрики
              if (localParticipant) {
                clientTranscriptionMetrics.incrementAudioChunks(sessionSlug, localParticipant.identity)
              }
              
              if (audioChunkCountRef.current === 1 || audioChunkCountRef.current % 100 === 0) {
                console.log('[Transcription] Audio chunk sent', {
                  chunkNumber: audioChunkCountRef.current,
                  bufferSize: pcm16.length,
                })
              }
            } catch (error) {
              console.error('[Transcription] Error sending audio:', error)
              // Записываем ошибку в метрики
              if (localParticipant) {
                const errorMsg = error instanceof Error ? error.message : String(error)
                clientTranscriptionMetrics.recordError(sessionSlug, localParticipant.identity, errorMsg)
              }
            }
          }

        // Загружаем AudioWorklet модуль и создаем AudioWorkletNode
        try {
          // Загружаем worklet processor
          await audioContext.audioWorklet.addModule('/audio/transcription-processor.js')
          console.log('[Transcription] AudioWorklet module loaded')

          // Создаем AudioWorkletNode
          const workletNode = new AudioWorkletNode(audioContext, 'transcription-processor')
          workletNodeRef.current = workletNode

          // Подписываемся на сообщения из worklet
          workletNode.port.onmessage = (event) => {
            if (event.data?.type === 'audio-data' && event.data?.buffer) {
              // Проверяем состояние AudioContext (может быть suspended в Chrome)
              if (audioContext.state === 'suspended') {
                // Пытаемся возобновить
                audioContext.resume().catch((error) => {
                  console.error('[Transcription] Failed to resume AudioContext:', error)
                })
                return
              }

              // Конвертируем ArrayBuffer обратно в Float32Array
              const float32Data = new Float32Array(event.data.buffer)
              
              // Конвертируем и отправляем (проверка mute будет внутри convertAndSendAudio)
              convertAndSendAudio(float32Data)
            }
          }

          // Подключаем worklet к источнику и к destination (или к глушителю)
          source.connect(workletNode)
          workletNode.connect(audioContext.destination) // Можно заменить на GainNode с gain=0, если не нужно выводить звук

          console.log('[Transcription] AudioWorkletNode created and connected')
        } catch (error) {
          console.error('[Transcription] Failed to create AudioWorkletNode:', error)
          // Fallback: если AudioWorklet не поддерживается, можно вернуться к ScriptProcessorNode
          // Но для современного проекта лучше просто выбросить ошибку
          throw new Error(`AudioWorklet not supported or failed to load: ${error}`)
        }

        // WebSocket уже подключен выше, теперь настраиваем обработчики
        console.log('[Transcription] ✅ WebSocket ready, setting up message handlers', {
          wsUrl: wsUrl.replace(/token=[^&]+/, 'token=***'),
          readyState: ws.readyState,
        })
        
        // Периодически проверяем состояние WebSocket (каждые 5 секунд)
        const healthCheckInterval = setInterval(() => {
          if (wsRef.current) {
            const state = wsRef.current.readyState
            if (state !== WebSocket.OPEN) {
              console.warn('[Transcription] ⚠️ WebSocket health check failed', {
                state,
                stateName: state === WebSocket.CONNECTING ? 'CONNECTING' :
                          state === WebSocket.OPEN ? 'OPEN' :
                          state === WebSocket.CLOSING ? 'CLOSING' :
                          state === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
              })
            } else {
              console.log('[Transcription] ✅ WebSocket health check OK', {
                chunkCount: audioChunkCountRef.current,
              })
            }
          }
        }, 5000)
        
        // Очищаем интервал при закрытии
        ws.addEventListener('close', () => {
          clearInterval(healthCheckInterval)
        })

        // Обработчик сообщений от сервера (определяем до onclose, чтобы можно было переиспользовать)
        const handleMessage = (event: MessageEvent) => {
          try {
            // Проверяем, что комната еще подключена
            if (!room || room.state !== ConnectionState.Connected || !localParticipant) {
              console.warn('[Transcription] Received message but room/participant not ready', {
                hasRoom: !!room,
                roomState: room?.state,
                hasLocalParticipant: !!localParticipant,
              })
              return
            }

            const data = JSON.parse(event.data)
            
            // Детальное логирование всех входящих сообщений
            console.log('[Transcription] 📨 WebSocket message received', {
              type: data.type,
              hasText: !!data.text,
              textLength: data.text?.length,
              isFinal: data.is_final,
              utteranceId: data.utterance_id || data.utteranceId,
              rawData: data,
            })

            if (data.type === 'transcription' && data.text?.trim() && isMountedRef.current) {
              const isFinal = Boolean(data.is_final)
              
              console.log('[Transcription] ✅ Processing transcription message', {
                text: data.text.substring(0, 100),
                isFinal,
                utteranceId: data.utterance_id || data.utteranceId || null,
              })
              
              // Обновляем метрики
              if (localParticipant) {
                clientTranscriptionMetrics.incrementTranscripts(
                  sessionSlug,
                  localParticipant.identity,
                  isFinal
                )
              }
              
              sendTranscriptFromServer({
                text: data.text,
                isFinal,
                utteranceId: data.utterance_id || data.utteranceId || null,
              })
            } else if (data.type === 'error') {
              console.error('[Transcription] Server error:', data.message || data)
              // Записываем ошибку в метрики
              if (localParticipant) {
                const errorMsg = data.message || 'Unknown server error'
                clientTranscriptionMetrics.recordError(sessionSlug, localParticipant.identity, errorMsg)
              }
            } else {
              // Логируем сообщения неизвестного формата
              console.warn('[Transcription] Unknown message format', {
                type: data.type,
                data: data,
              })
            }
          } catch (error) {
            console.error('[Transcription] Error parsing server message:', error, {
              eventData: event.data,
            })
          }
        }

        ws.onmessage = handleMessage

        // Обработчик ошибок WebSocket
        ws.onerror = (error) => {
          console.error('[Transcription] WebSocket error:', error)
          wsReadyRef.current = false
          // Не вызываем room.disconnect() - WebSocket не должен ломать LiveKit комнату
        }

        // Функция для переподключения WebSocket
        // ВАЖНО: Эта функция сохраняет все замыкания, включая handleMessage и convertAndSendAudio
        const reconnectWebSocket = async () => {
          if (!isMountedRef.current || !isActive) {
            console.log('[Transcription] Skipping WebSocket reconnect - not mounted or not active', {
              isMounted: isMountedRef.current,
              isActive,
            })
            return
          }

          // Проверяем, что комната всё ещё подключена
          if (!room || room.state !== ConnectionState.Connected || !localParticipant) {
            console.log('[Transcription] Room not connected, skipping WebSocket reconnect', {
              hasRoom: !!room,
              roomState: room?.state,
              hasLocalParticipant: !!localParticipant,
            })
            return
          }

          // Проверяем, что пайплайн всё ещё работает (AudioContext и Worklet должны быть активны)
          if (!audioContextRef.current || !workletNodeRef.current) {
            console.log('[Transcription] Audio pipeline not running, skipping WebSocket reconnect - will restart full pipeline')
            return
          }

          console.log('[Transcription] Attempting to reconnect WebSocket while keeping audio pipeline running...')
          
          // Проверяем, что transcriptionToken доступен для переподключения
          if (!transcriptionTokenRef.current) {
            console.error('[Transcription] Missing transcriptionToken for reconnection')
            return
          }
          
          // Создаем новый URL с актуальным transcriptionToken (используем ту же логику, что и в startTranscription)
          let reconnectWsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost'
          reconnectWsHost = reconnectWsHost.replace(/^https?:\/\//, '').replace(/\/$/, '')
          
          const reconnectIsProductionHost = reconnectWsHost !== 'localhost' && !reconnectWsHost.startsWith('127.0.0.1') && !reconnectWsHost.startsWith('192.168.')
          const reconnectIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
          const reconnectIsProduction = reconnectIsProductionHost || reconnectIsHttps
          const reconnectWsProtocol = reconnectIsProduction ? 'wss' : 'ws'
          
          const reconnectWsPort = process.env.NEXT_PUBLIC_WS_PORT
          let reconnectPortSuffix = ''
          // ВАЖНО: Если порт явно указан в переменной окружения, используем его даже для production
          // Это необходимо для Render и других платформ, где WebSocket сервер работает на нестандартном порту
          if (reconnectWsPort) {
            reconnectPortSuffix = `:${reconnectWsPort}`
          } else if (!reconnectIsProduction) {
            // Для dev окружения используем порт по умолчанию
            reconnectPortSuffix = ':3001'
          }
          // Для production без явного порта - используем стандартный порт (443 для WSS, не указываем в URL)
          
          const reconnectWsUrl = `${reconnectWsProtocol}://${reconnectWsHost}${reconnectPortSuffix}/api/realtime/transcribe?token=${encodeURIComponent(transcriptionTokenRef.current)}`
          
          // ВАЖНО: Если серверная транскрипция включена, не переподключаемся
          if (SERVER_TRANSCRIPTION_ENABLED) {
            console.log('[Transcription] Server transcription enabled, skipping WebSocket reconnection')
            return
          }
          
          try {
            const newWs = await connectTranscriptionWebSocket(reconnectWsUrl, {
              maxRetries: 3, // Меньше попыток при переподключении
              baseDelayMs: 500,
              timeoutMs: 5000,
            })
            
            // Сохраняем старый WebSocket для закрытия (если был)
            const oldWs = wsRef.current
            if (oldWs && oldWs.readyState !== WebSocket.CLOSED) {
              try {
                oldWs.close()
              } catch (e) {
                console.warn('[Transcription] Error closing old WebSocket:', e)
              }
            }
            
            wsRef.current = newWs
            wsReadyRef.current = true
            // Сбрасываем счетчик, чтобы логирование работало корректно после переподключения
            audioChunkCountRef.current = 0
            console.log('[Transcription] ✅ WebSocket reconnected successfully, audio pipeline continues', {
              wsReady: wsReadyRef.current,
              hasAudioContext: !!audioContextRef.current,
              hasWorklet: !!workletNodeRef.current,
            })

            // Настраиваем обработчики для нового WebSocket
            newWs.onmessage = handleMessage
            newWs.onerror = (error) => {
              console.error('[Transcription] Reconnected WebSocket error:', error)
              wsReadyRef.current = false
            }
            newWs.onclose = (event) => {
              wsReadyRef.current = false
              console.log('[Transcription] Reconnected WebSocket closed', {
                code: event.code,
                reason: event.reason,
              })
              
              // Если закрылось не по нашей инициативе (код 1000) и транскрипция активна, переподключаемся
              if (event.code !== 1000 && isActive && room && room.state === ConnectionState.Connected && localParticipant && isMountedRef.current && audioContextRef.current) {
                // Очищаем предыдущий timeout
                if (wsReconnectTimeoutRef.current) {
                  clearTimeout(wsReconnectTimeoutRef.current)
                }
                // Пытаемся переподключиться снова
                wsReconnectTimeoutRef.current = setTimeout(reconnectWebSocket, 1000)
              }
            }
          } catch (error) {
            console.error('[Transcription] Failed to reconnect WebSocket:', error)
            // Если не удалось переподключиться, но транскрипция активна, пробуем еще раз
            if (isActive && room && room.state === ConnectionState.Connected && localParticipant && isMountedRef.current && audioContextRef.current) {
              if (wsReconnectTimeoutRef.current) {
                clearTimeout(wsReconnectTimeoutRef.current)
              }
              wsReconnectTimeoutRef.current = setTimeout(reconnectWebSocket, 2000) // Увеличиваем задержку
            }
          }
        }

        // Обработчик закрытия WebSocket с автоматическим переподключением
        ws.onclose = (event) => {
          wsReadyRef.current = false
          console.log('[Transcription] ⚠️ WebSocket CLOSED', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            isActive,
            roomState: room?.state,
            hasLocalParticipant: !!localParticipant,
            isMounted: isMountedRef.current,
            hasAudioContext: !!audioContextRef.current,
          })

          // Если закрылось не по нашей инициативе (код 1000) и транскрипция активна, пытаемся переподключиться
          if (
            event.code !== 1000 && // Не нормальное закрытие
            isActive &&
            room &&
            room.state === ConnectionState.Connected &&
            localParticipant &&
            isMountedRef.current &&
            audioContextRef.current
          ) {
            console.log('[Transcription] 🔄 WebSocket closed unexpectedly, will reconnect...')
            // Очищаем предыдущий timeout, если он есть
            if (wsReconnectTimeoutRef.current) {
              clearTimeout(wsReconnectTimeoutRef.current)
            }

            // Пытаемся переподключиться через небольшую задержку
            wsReconnectTimeoutRef.current = setTimeout(() => {
              console.log('[Transcription] 🔄 Attempting WebSocket reconnection...')
              reconnectWebSocket()
            }, 1000)
          } else {
            console.log('[Transcription] ❌ WebSocket closed, but reconnection conditions not met', {
              codeNot1000: event.code !== 1000,
              isActive,
              roomConnected: room?.state === ConnectionState.Connected,
              hasLocalParticipant: !!localParticipant,
              isMounted: isMountedRef.current,
              hasAudioContext: !!audioContextRef.current,
            })
          }
        }
        // Сброс счетчика при старте
        audioChunkCountRef.current = 0

        // Инициализируем метрики
        if (localParticipant) {
          transcriptionStartedAtRef.current = new Date()
          clientTranscriptionMetrics.startSession(sessionSlug, localParticipant.identity)
          console.log('[Transcription] Metrics initialized', {
            sessionSlug,
            participantIdentity: localParticipant.identity,
          })
        }

        console.log('[Transcription] Transcription started with AudioWorklet')
        isStartingRef.current = false
      } catch (error) {
        console.error('[Transcription] Failed to start transcription:', error)
        isStartingRef.current = false
        // Сбрасываем lastStartAttemptRef, чтобы можно было повторить попытку через 2 секунды
        lastStartAttemptRef.current = 0
      }
    }

        // Запускаем транскрипцию только если она еще не запущена
        // При Reconnected проверяем, нужно ли перезапустить (если WebSocket закрыт)
        let startTimeout: NodeJS.Timeout | null = null
        
        if (connectionState === ConnectionState.Connected) {
          // Если транскрипция уже работает и WebSocket открыт - ничего не делаем
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && audioContextRef.current && workletNodeRef.current) {
            console.log('[Transcription] Already running and connected, no restart needed')
            return
          }

          // Если только что переподключились (есть старый WebSocket или AudioContext), даем задержку
          // Иначе запускаем сразу
          const delay = (wsRef.current || audioContextRef.current) ? 500 : 0
          startTimeout = setTimeout(() => {
            // Проверяем, что транскрипция всё ещё должна быть активна
            if (isActive && connectionState === ConnectionState.Connected && room && localParticipant) {
          // Если WebSocket закрыт или AudioContext отсутствует, перезапускаем транскрипцию
          const needsRestart = !wsRef.current || 
                               wsRef.current.readyState !== WebSocket.OPEN || 
                               !audioContextRef.current || 
                               !workletNodeRef.current
          
          if (needsRestart) {
            console.log('[Transcription] Restarting transcription after reconnected', {
              hasWs: !!wsRef.current,
              wsState: wsRef.current?.readyState,
              hasAudioContext: !!audioContextRef.current,
              hasWorkletNode: !!workletNodeRef.current,
            })
            startTranscription()
          }
        }
      }, delay)
    }

    return () => {
      if (startTimeout) {
        clearTimeout(startTimeout)
      }
      // Мягкая очистка при размонтировании или изменении состояния
      stopTranscription()
    }
  }, [isActive, room, localParticipant, connectionState, sendTranscriptFromServer, sessionSlug, stopTranscription])

  return {
    isActive,
    start: () => {
      setIsActive(true)
    },
    stop: () => {
      setIsActive(false)
    },
    sendTranscriptFromServer,
    setOnTranscriptCallback: (callback: ((message: TranscriptMessage) => void) | null) => {
      onTranscriptCallbackRef.current = callback
    },
  }
}


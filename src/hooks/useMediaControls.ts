// src/hooks/useMediaControls.ts
// Общий хук для управления медиа (микрофон, камера, screen share)

'use client'

import { useState, useCallback } from 'react'
import { LocalParticipant, Track } from 'livekit-client'
import { logError } from '@/lib/error-handling'

interface UseMediaControlsOptions {
  localParticipant: LocalParticipant | null
}

interface UseMediaControlsReturn {
  micEnabled: boolean
  cameraEnabled: boolean
  screenShareEnabled: boolean
  toggleMicrophone: (enabled: boolean) => Promise<void>
  toggleCamera: (enabled: boolean) => Promise<void>
  toggleScreenShare: (enabled: boolean) => Promise<void>
  setMicEnabled: (enabled: boolean) => void
  setCameraEnabled: (enabled: boolean) => void
  setScreenShareEnabled: (enabled: boolean) => void
}

/**
 * Хук для управления медиа-контролами (микрофон, камера, screen share).
 * 
 * Предоставляет состояние и функции для переключения медиа-треков.
 */
export function useMediaControls({ localParticipant }: UseMediaControlsOptions): UseMediaControlsReturn {
  const [micEnabled, setMicEnabled] = useState(true) // По умолчанию микрофон включен в LiveKit
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)

  const toggleMicrophone = useCallback(
    async (enabled: boolean) => {
      if (!localParticipant) {
        console.warn('[useMediaControls] No localParticipant for toggleMicrophone')
        return
      }

      try {
        await localParticipant.setMicrophoneEnabled(enabled)
        setMicEnabled(enabled)
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          action: 'toggleMicrophone',
          enabled,
        })
        // Не обновляем состояние при ошибке
      }
    },
    [localParticipant]
  )

  const toggleCamera = useCallback(
    async (enabled: boolean) => {
      if (!localParticipant) {
        console.warn('[useMediaControls] No localParticipant for toggleCamera')
        return
      }

      try {
        await localParticipant.setCameraEnabled(enabled)
        setCameraEnabled(enabled)
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          action: 'toggleCamera',
          enabled,
        })
      }
    },
    [localParticipant]
  )

  const toggleScreenShare = useCallback(
    async (enabled: boolean) => {
      if (!localParticipant) {
        console.warn('[useMediaControls] No localParticipant for toggleScreenShare')
        return
      }

      try {
        if (enabled) {
          await localParticipant.setScreenShareEnabled(true)
          setScreenShareEnabled(true)
        } else {
          await localParticipant.setScreenShareEnabled(false)
          setScreenShareEnabled(false)
        }
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          action: 'toggleScreenShare',
          enabled,
        })
      }
    },
    [localParticipant]
  )

  return {
    micEnabled,
    cameraEnabled,
    screenShareEnabled,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
    setMicEnabled,
    setCameraEnabled,
    setScreenShareEnabled,
  }
}


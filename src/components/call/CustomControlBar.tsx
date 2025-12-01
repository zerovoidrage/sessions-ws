'use client'

import { Track } from 'livekit-client'
import { 
  useTrackToggle, 
  useLocalParticipantPermissions,
  ChatToggle,
  DisconnectButton,
  useMaybeLayoutContext
} from '@livekit/components-react'
import { 
  Microphone, 
  MicrophoneSlash, 
  Camera, 
  CameraSlash, 
  Presentation, 
  Stop,
  ChatCircle,
  SignOut
} from '@phosphor-icons/react'
import { useState } from 'react'
import { supportsScreenSharing } from '@livekit/components-core'

interface CustomControlBarProps {
  className?: string
}

export function CustomControlBar({ className = '' }: CustomControlBarProps) {
  const permissions = useLocalParticipantPermissions()
  const [isScreenShareEnabled, setIsScreenShareEnabled] = useState(false)

  // Microphone toggle
  const {
    buttonProps: micButtonProps,
    enabled: micEnabled,
  } = useTrackToggle({ source: Track.Source.Microphone })

  // Camera toggle
  const {
    buttonProps: cameraButtonProps,
    enabled: cameraEnabled,
  } = useTrackToggle({ source: Track.Source.Camera })

  // Screen share toggle
  const {
    buttonProps: screenShareButtonProps,
    enabled: screenShareEnabled,
  } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true, selfBrowserSurface: 'include' },
    onChange: (enabled) => setIsScreenShareEnabled(enabled),
  })

  const browserSupportsScreenSharing = supportsScreenSharing()

  const canPublishSource = (source: Track.Source) => {
    if (!permissions) return false
    const sourceMap: Partial<Record<Track.Source, number>> = {
      [Track.Source.Camera]: 1,
      [Track.Source.Microphone]: 2,
      [Track.Source.ScreenShare]: 3,
    }
    const sourceValue = sourceMap[source]
    if (sourceValue === undefined) return false
    return (
      permissions.canPublish &&
      (permissions.canPublishSources.length === 0 ||
        permissions.canPublishSources.includes(sourceValue))
    )
  }

  const canPublishMic = canPublishSource(Track.Source.Microphone)
  const canPublishCamera = canPublishSource(Track.Source.Camera)
  const canPublishScreenShare = canPublishSource(Track.Source.ScreenShare) && browserSupportsScreenSharing
  const canPublishChat = permissions?.canPublishData ?? false

  return (
    <div className={`flex items-center justify-center gap-4 ${className}`}>
      {canPublishMic && (
        <button
          {...micButtonProps}
          className="flex items-center gap-2 px-4 py-2 text-white-900 hover:opacity-80 transition-opacity"
        >
          {micEnabled ? (
            <Microphone size={20} weight="fill" />
          ) : (
            <MicrophoneSlash size={20} weight="fill" />
          )}
          <span className="text-sm">Microphone</span>
        </button>
      )}

      {canPublishCamera && (
        <button
          {...cameraButtonProps}
          className="flex items-center gap-2 px-4 py-2 text-white-900 hover:opacity-80 transition-opacity"
        >
          {cameraEnabled ? (
            <Camera size={20} weight="fill" />
          ) : (
            <CameraSlash size={20} weight="fill" />
          )}
          <span className="text-sm">Camera</span>
        </button>
      )}

      {canPublishScreenShare && (
        <button
          {...screenShareButtonProps}
          className="flex items-center gap-2 px-4 py-2 text-white-900 hover:opacity-80 transition-opacity"
        >
          {screenShareEnabled ? (
            <Stop size={20} weight="fill" />
          ) : (
            <Presentation size={20} weight="fill" />
          )}
          <span className="text-sm">
            {screenShareEnabled ? 'Stop screen share' : 'Share screen'}
          </span>
        </button>
      )}

      {canPublishChat && (
        <ChatToggle className="flex items-center gap-2 px-4 py-2 text-white-900 hover:opacity-80 transition-opacity">
          <ChatCircle size={20} weight="fill" />
          <span className="text-sm">Chat</span>
        </ChatToggle>
      )}

      <DisconnectButton className="flex items-center gap-2 px-4 py-2 text-white-900 hover:opacity-80 transition-opacity">
        <SignOut size={20} weight="fill" />
        <span className="text-sm">Leave</span>
      </DisconnectButton>
    </div>
  )
}


'use client'

import { Track } from 'livekit-client'
import { 
  Microphone, 
  MicrophoneSlash, 
  VideoCamera, 
  VideoCameraSlash, 
  MonitorArrowUp, 
  Stop,
  ChatCircle,
  Power
} from '@phosphor-icons/react'
import { Button } from '../button'
import { cn } from '@/lib/utils'

import { EqualizerIcon } from '../equalizer-icon/EqualizerIcon'

export interface ControlBarProps {
  onMicrophoneToggle?: (enabled: boolean) => void
  onCameraToggle?: (enabled: boolean) => void
  onScreenShareToggle?: (enabled: boolean) => void
  onChatToggle?: () => void
  onLeave?: () => void
  microphoneEnabled?: boolean
  microphoneConnecting?: boolean
  cameraEnabled?: boolean
  screenShareEnabled?: boolean
  isCreator?: boolean
  className?: string
}

export function ControlBar({
  onMicrophoneToggle,
  onCameraToggle,
  onScreenShareToggle,
  onChatToggle,
  onLeave,
  microphoneEnabled = false,
  microphoneConnecting = false,
  cameraEnabled = false,
  screenShareEnabled = false,
  isCreator = false,
  className,
}: ControlBarProps) {
  const micState = microphoneConnecting
    ? 'connecting'
    : microphoneEnabled
    ? 'active'
    : 'muted'

  return (
    <div className={cn('flex items-center justify-center gap-3', className)}>
      {onMicrophoneToggle && (
        <Button
          variant={micState === 'active' ? "primary" : "secondary"}
          size="md"
          onClick={() => !microphoneConnecting && onMicrophoneToggle(!microphoneEnabled)}
          disabled={microphoneConnecting}
          className={cn(
            microphoneConnecting && 'cursor-default animate-pulse-opacity'
          )}
          title={microphoneConnecting ? 'Connecting...' : undefined}
        >
          {micState === 'connecting' ? (
            <EqualizerIcon size={20} className="text-current" />
          ) : microphoneEnabled ? (
            "muted"
          ) : (
            "unmuted"
          )}
        </Button>
      )}

      {onCameraToggle && (
        <Button
          variant="ghost"
          size="md"
          onClick={() => onCameraToggle(!cameraEnabled)}
          className="flex items-center justify-center text-white-700 hover:text-white-900"
        >
          {cameraEnabled ? (
            <VideoCamera size={20} weight="regular" />
          ) : (
            <VideoCameraSlash size={20} weight="regular" />
          )}
        </Button>
      )}

      {onScreenShareToggle && (
        <Button
          variant="ghost"
          size="md"
          onClick={() => onScreenShareToggle(!screenShareEnabled)}
          className="flex items-center justify-center text-white-700 hover:text-white-900"
        >
          {screenShareEnabled ? (
            <Stop size={20} weight="regular" />
          ) : (
            <MonitorArrowUp size={20} weight="regular" />
          )}
        </Button>
      )}

      {onChatToggle && (
        <Button
          variant="ghost"
          size="md"
          onClick={onChatToggle}
          className="flex items-center justify-center text-white-700 hover:text-white-900"
        >
          <ChatCircle size={20} weight="regular" />
        </Button>
      )}

      {onLeave && (
        <Button
          variant="ghost"
          size="md"
          onClick={onLeave}
          className="flex items-center justify-center text-white-700 hover:text-white-900"
        >
          <Power size={20} weight="regular" />
        </Button>
      )}
    </div>
  )
}


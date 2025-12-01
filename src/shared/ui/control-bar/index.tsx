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

export interface ControlBarProps {
  onMicrophoneToggle?: (enabled: boolean) => void
  onCameraToggle?: (enabled: boolean) => void
  onScreenShareToggle?: (enabled: boolean) => void
  onChatToggle?: () => void
  onLeave?: () => void
  microphoneEnabled?: boolean
  cameraEnabled?: boolean
  screenShareEnabled?: boolean
  className?: string
}

export function ControlBar({
  onMicrophoneToggle,
  onCameraToggle,
  onScreenShareToggle,
  onChatToggle,
  onLeave,
  microphoneEnabled = false,
  cameraEnabled = false,
  screenShareEnabled = false,
  className,
}: ControlBarProps) {
  return (
    <div className={cn('flex items-center justify-center gap-3', className)}>
      {onMicrophoneToggle && (
        <Button
          variant={microphoneEnabled ? "primary" : "secondary"}
          size="md"
          onClick={() => onMicrophoneToggle(!microphoneEnabled)}
        >
          {microphoneEnabled ? "muted" : "unmuted"}
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
            <VideoCamera size={24} weight="regular" />
          ) : (
            <VideoCameraSlash size={24} weight="regular" />
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
            <Stop size={24} weight="regular" />
          ) : (
            <MonitorArrowUp size={24} weight="regular" />
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
          <ChatCircle size={24} weight="regular" />
        </Button>
      )}

      {onLeave && (
        <Button
          variant="ghost"
          size="md"
          onClick={onLeave}
          className="flex items-center justify-center text-white-700 hover:text-white-900"
        >
          <Power size={24} weight="regular" />
        </Button>
      )}
    </div>
  )
}


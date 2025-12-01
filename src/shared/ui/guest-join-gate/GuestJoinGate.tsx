'use client'

import { useState } from 'react'

export interface GuestJoinGateProps {
  sessionSlug: string
  onJoined: (guest: { identity: string; displayName: string }) => void
}

export function GuestJoinGate({ sessionSlug, onJoined }: GuestJoinGateProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isJoining, setIsJoining] = useState(false)

  const generateGuestIdentity = (): string => {
    // Используем crypto.randomUUID() если доступен, иначе fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `guest-${crypto.randomUUID()}`
    }
    // Fallback для старых браузеров
    return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const handleJoin = async () => {
    const trimmedName = name.trim()
    
    if (!trimmedName) {
      return
    }

    setIsJoining(true)
    setError(null)

    try {
      const identity = generateGuestIdentity()

      const res = await fetch(`/api/sessions/${sessionSlug}/participants/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity,
          name: trimmedName,
          role: 'GUEST',
          isGuest: true,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to join session')
      }

      onJoined({ identity, displayName: trimmedName })
    } catch (err) {
      console.error('Error joining as guest:', err)
      setError(err instanceof Error ? err.message : 'Failed to join session')
      setIsJoining(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isJoining) {
      handleJoin()
    }
  }

  return (
    <div className="min-h-screen w-full bg-black flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter your name…"
          disabled={isJoining}
          className="bg-transparent border-none outline-none text-white-900 text-2xl text-center placeholder:text-neutral-500 w-full disabled:opacity-50"
        />
        {error && (
          <p className="mt-4 text-center text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}


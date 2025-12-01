'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/ui/button'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'

interface OnboardingClientProps {
  user: DomainUser
}

type OnboardingStep = 1 | 2 | 3

export function OnboardingClient({ user }: OnboardingClientProps) {
  const router = useRouter()
  const [step, setStep] = useState<OnboardingStep>(1)
  const [displayName, setDisplayName] = useState(user.name || '')
  const [spaceName, setSpaceName] = useState(`${displayName || 'My'}'s space`)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Обновляем spaceName при изменении displayName
  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value)
    if (!value.trim()) {
      setSpaceName("My space")
    } else {
      setSpaceName(`${value}'s space`)
    }
  }

  const handleNextStep = () => {
    if (step === 1 && displayName.trim()) {
      setStep(2)
    } else if (step === 2 && spaceName.trim()) {
      setStep(3)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      if (step === 1 && displayName.trim()) {
        handleNextStep()
      } else if (step === 2 && spaceName.trim()) {
        handleNextStep()
      }
    }
  }

  const handleAvatarUpload = async (file: File) => {
    try {
      // Получаем подпись
      const signRes = await fetch('/api/identity/avatar/sign')
      if (!signRes.ok) {
        throw new Error('Failed to get upload signature')
      }
      const { timestamp, signature, apiKey, cloudName, folder } = await signRes.json()

      // Загружаем в Cloudinary
      const formData = new FormData()
      formData.append('file', file)
      formData.append('api_key', apiKey)
      formData.append('timestamp', timestamp.toString())
      formData.append('signature', signature)
      formData.append('folder', folder)

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!uploadRes.ok) {
        throw new Error('Failed to upload avatar')
      }

      const uploadData = await uploadRes.json()
      setAvatarUrl(uploadData.secure_url)
    } catch (err) {
      console.error('Error uploading avatar:', err)
      setError('Failed to upload avatar')
    }
  }

  const handleGetStarted = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Обновляем профиль
      const profileRes = await fetch('/api/identity/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          avatarUrl,
        }),
      })

      if (!profileRes.ok) {
        const errorData = await profileRes.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to update profile')
      }

      // Создаем Space
      const spaceRes = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: spaceName.trim(),
          mode: 'SESSIONS_ONLY',
        }),
      })

      if (!spaceRes.ok) {
        throw new Error('Failed to create space')
      }

      const space = await spaceRes.json()

      // Устанавливаем Space активным
      const setActiveRes = await fetch(`/api/spaces/${space.id}/set-active`, {
        method: 'POST',
      })

      if (!setActiveRes.ok) {
        throw new Error('Failed to set active space')
      }

      // Редирект на /sessions
      router.push('/sessions')
      router.refresh()
    } catch (err) {
      console.error('Error completing onboarding:', err)
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black relative">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="px-4 py-4">
          <h1 className="text-sm text-white-900 text-center">
            {step === 1 && 'your display name'}
            {step === 2 && 'enter space name'}
            {step === 3 && 'setup avatar'}
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-screen flex items-center justify-center p-4 pt-20 pb-20">
        <div className="w-full max-w-md">
          {step === 1 && (
            <div className="w-full max-w-md px-4">
              <input
                autoFocus
                value={displayName}
                onChange={(e) => {
                  handleDisplayNameChange(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter your display name…"
                disabled={isLoading}
                className="bg-transparent border-none outline-none text-white-900 text-2xl text-center placeholder:text-white-500 w-full disabled:opacity-50"
              />
              {error && (
                <p className="mt-4 text-center text-sm text-red-400">{error}</p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="w-full max-w-md px-4">
              <input
                autoFocus
                value={spaceName}
                onChange={(e) => {
                  setSpaceName(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter space name…"
                disabled={isLoading}
                className="bg-transparent border-none outline-none text-white-900 text-2xl text-center placeholder:text-white-500 w-full disabled:opacity-50"
              />
              {error && (
                <p className="mt-4 text-center text-sm text-red-400">{error}</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center gap-4">
              <Avatar
                userId={user.id}
                displayName={displayName || user.email}
                avatarUrl={avatarUrl}
                noAvatarColor={user.noAvatarColor || undefined}
                size="lg"
              />
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      handleAvatarUpload(file)
                    }
                  }}
                />
                <span className="text-callout text-white-700 hover:text-white-900 underline">
                  Upload avatar
                </span>
              </label>
              <button
                type="button"
                onClick={() => setAvatarUrl(null)}
                className="text-callout text-white-500 hover:text-white-700 text-sm"
              >
                Remove avatar
              </button>
              {error && (
                <div className="text-callout text-red-500 bg-red-500/10 px-4 py-2 rounded-lg mt-4">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Button */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8">
        {step === 1 && (
          <Button
            onClick={handleNextStep}
            disabled={isLoading || !displayName.trim()}
            variant="primary"
            size="lg"
          >
            Continue
          </Button>
        )}
        {step === 2 && (
          <Button
            onClick={handleNextStep}
            disabled={isLoading || !spaceName.trim()}
            variant="primary"
            size="lg"
          >
            Continue
          </Button>
        )}
        {step === 3 && (
          <Button
            onClick={handleGetStarted}
            disabled={isLoading}
            variant="primary"
            size="lg"
          >
            {isLoading ? 'Setting up...' : 'Get started'}
          </Button>
        )}
      </div>
    </div>
  )
}


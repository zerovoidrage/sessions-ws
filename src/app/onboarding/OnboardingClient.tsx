'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/ui/button'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import { Input } from '@/shared/ui/input'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'

interface OnboardingClientProps {
  user: DomainUser
}

export function OnboardingClient({ user }: OnboardingClientProps) {
  const router = useRouter()
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-display text-white-900 mb-8 text-center">Welcome!</h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Upload */}
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
          </div>

          {/* Display Name */}
          <div>
            <label htmlFor="displayName" className="block text-callout text-white-700 mb-2">
              Display name *
            </label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              placeholder="Enter your display name"
            />
          </div>

          {/* Space Name */}
          <div>
            <label htmlFor="spaceName" className="block text-callout text-white-700 mb-2">
              Space name *
            </label>
            <Input
              id="spaceName"
              type="text"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              required
              minLength={1}
              maxLength={50}
              placeholder="Enter space name"
            />
          </div>

          {error && (
            <div className="text-callout text-red-500 bg-red-500/10 px-4 py-2 rounded-lg">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !displayName.trim() || !spaceName.trim()}
            className="w-full"
          >
            {isLoading ? 'Setting up...' : 'Continue'}
          </Button>
        </form>
      </div>
    </div>
  )
}


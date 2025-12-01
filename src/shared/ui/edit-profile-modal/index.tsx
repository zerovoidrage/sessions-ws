'use client'

import { useState, useEffect } from 'react'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'

export interface EditProfileModalProps {
  isOpen: boolean
  onClose: () => void
  user: DomainUser
  onSave: (updatedUser: DomainUser) => void
}

export function EditProfileModal({ isOpen, onClose, user, onSave }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName || user.name || '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  // Сбрасываем состояние при открытии модалки
  useEffect(() => {
    if (isOpen) {
      setDisplayName(user.displayName || user.name || '')
      setAvatarUrl(user.avatarUrl || null)
      setError(null)
      setIsLoading(false)
      setIsUploading(false)
    }
  }, [isOpen, user])

  const handleAvatarUpload = async (file: File) => {
    try {
      setIsUploading(true)
      setError(null)

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
      setError(err instanceof Error ? err.message : 'Failed to upload avatar')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSave = async () => {
    if (!displayName.trim()) return

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

      const updatedUser = await profileRes.json()
      onSave(updatedUser)
      onClose()
    } catch (err) {
      console.error('Error updating profile:', err)
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading && displayName.trim()) {
      handleSave()
    }
  }

  // Закрытие по ESC
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="text-center w-full max-w-md px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avatar */}
        <div className="flex flex-col items-center gap-4 mb-8">
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
              disabled={isUploading || isLoading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  handleAvatarUpload(file)
                }
              }}
            />
            <span className="text-4xl text-white-500 hover:opacity-60 transition-opacity underline">
              {isUploading ? 'Uploading...' : 'Upload avatar'}
            </span>
          </label>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              disabled={isUploading || isLoading}
              className="text-4xl text-white-500 hover:opacity-60 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Remove avatar
            </button>
          )}
        </div>

        {/* Display Name Input */}
        <div className="mb-8">
          <input
            autoFocus
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
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

        {/* Save Button */}
        <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8">
          <button
            onClick={handleSave}
            disabled={isLoading || isUploading || !displayName.trim()}
            className="px-8 py-4 bg-white text-black rounded-full text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}


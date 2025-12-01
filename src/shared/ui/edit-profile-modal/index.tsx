'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/shared/ui/button'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import { Input } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { cn } from '@/lib/utils'
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Profile">
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
              disabled={isUploading || isLoading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  handleAvatarUpload(file)
                }
              }}
            />
            <span
              className={cn(
                'text-callout text-white-700 hover:text-white-900 underline',
                (isUploading || isLoading) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {isUploading ? 'Uploading...' : 'Upload avatar'}
            </span>
          </label>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              disabled={isUploading || isLoading}
              className="text-callout text-white-500 hover:text-white-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Remove avatar
            </button>
          )}
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
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={2}
            maxLength={40}
            placeholder="Enter your display name"
            disabled={isLoading}
          />
        </div>

        {error && (
          <div className="text-callout text-red-500 bg-red-500/10 px-4 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading || isUploading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoading || isUploading || !displayName.trim()}
            variant="primary"
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}


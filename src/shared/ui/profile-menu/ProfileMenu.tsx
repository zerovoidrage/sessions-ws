'use client'

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import { Avatar } from '../avatar/Avatar'
import { Button } from '../button'
import { EditProfileModal } from '../edit-profile-modal'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'

export interface ProfileMenuProps {
  user: DomainUser
  onUserUpdate?: (updatedUser: DomainUser) => void
}

export function ProfileMenu({ user, onUserUpdate }: ProfileMenuProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<DomainUser>(user)

  // Обновляем currentUser когда user меняется извне
  useEffect(() => {
    setCurrentUser(user)
  }, [user])

  const handleEditClick = () => {
    setIsEditModalOpen(true)
  }

  const handleSave = (updatedUser: DomainUser) => {
    setCurrentUser(updatedUser)
    if (onUserUpdate) {
      onUserUpdate(updatedUser)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={handleEditClick}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer bg-transparent border-none p-0 text-left"
        >
          <Avatar
            userId={currentUser.id}
            displayName={currentUser.displayName || currentUser.email}
            avatarUrl={currentUser.avatarUrl}
            noAvatarColor={currentUser.noAvatarColor}
            size="sm"
          />
          <div className="flex flex-col text-left">
            <span className="text-sm text-white-900">
              {currentUser.displayName || currentUser.email}
            </span>
            {currentUser.displayName && (
              <span className="text-xs text-white-600">{currentUser.email}</span>
            )}
          </div>
        </button>
        <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/' })}>
          Sign out
        </Button>
      </div>

      <EditProfileModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        user={currentUser}
        onSave={handleSave}
      />
    </>
  )
}


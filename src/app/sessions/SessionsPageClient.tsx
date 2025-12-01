'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/shared/ui/button'
import { type UISpace } from '@/shared/ui/space-switcher/SpaceSwitcher'
import { Avatar } from '@/shared/ui/avatar/Avatar'
import { CaretDown, Pencil, Trash } from '@phosphor-icons/react'
import { signOut } from 'next-auth/react'
import { EditProfileModal } from '@/shared/ui/edit-profile-modal'
import { cn } from '@/lib/utils'
import type { Session } from '@/modules/core/sessions/domain/session.types'
import type { DomainUser } from '@/modules/core/identity/domain/user.types'
import type { Space } from '@/modules/core/spaces/domain/space.types'

interface SessionsPageClientProps {
  user: DomainUser
  spaces: Space[]
  activeSpaceId: string
  activeSpaceMode: 'SESSIONS_ONLY' | 'SESSIONS_AND_TASKS'
  sessions: Session[]
}

export function SessionsPageClient({
  user,
  spaces,
  activeSpaceId,
  activeSpaceMode,
  sessions: initialSessions,
}: SessionsPageClientProps) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [currentUser, setCurrentUser] = useState<DomainUser>(user)
  const [isKillingAll, setIsKillingAll] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false)
  const isDeletingRef = useRef(false) // Флаг для предотвращения перезагрузки во время удаления

  // Закрытие модалок по ESC
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isWorkspaceModalOpen) {
          setIsWorkspaceModalOpen(false)
        }
        if (isProfileModalOpen) {
          setIsProfileModalOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isWorkspaceModalOpen, isProfileModalOpen])

  // Обновляем currentUser когда user меняется извне
  useEffect(() => {
    setCurrentUser(user)
  }, [user])

  const handleUserUpdate = async (updatedUser: DomainUser) => {
    setCurrentUser(updatedUser)
    // Обновляем данные на сервере
    router.refresh()
  }

  // Обновляем список сессий при изменении activeSpaceId или при возврате на страницу
  useEffect(() => {
    const loadSessions = async () => {
      // Не загружаем список, если идет процесс удаления
      if (isDeletingRef.current) {
        return
      }

      try {
        const res = await fetch('/api/sessions')
        if (res.ok) {
          const data = await res.json()
          // Конвертируем строки дат в объекты Date
          const sessions = (data.sessions || []).map((session: any) => ({
            ...session,
            createdAt: session.createdAt ? new Date(session.createdAt) : new Date(),
            endedAt: session.endedAt ? new Date(session.endedAt) : null,
          }))
          setSessions(sessions)
        }
      } catch (error) {
        console.error('Failed to load sessions:', error)
      }
    }

    loadSessions()

    // Обновляем при фокусе страницы (когда пользователь возвращается)
    const handleFocus = () => {
      loadSessions()
    }

    // Обновляем при возврате на вкладку (visibilitychange)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadSessions()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeSpaceId])

  // Синхронизируем с initialSessions при изменении пропсов
  useEffect(() => {
    // Не обновляем список, если идет процесс удаления
    if (isDeletingRef.current) {
      return
    }

    // Конвертируем строки дат в объекты Date, если нужно
    const sessions = initialSessions.map((session) => ({
      ...session,
      createdAt: session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt),
      endedAt: session.endedAt ? (session.endedAt instanceof Date ? session.endedAt : new Date(session.endedAt)) : null,
    }))
    setSessions(sessions)
  }, [initialSessions])

  const handleCreateSession = async () => {
    try {
      setIsCreating(true)
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId: activeSpaceId }),
      })

      if (!res.ok) {
        throw new Error('Failed to create session')
      }

      const data = await res.json()
      router.push(`/session/${data.slug}`)
    } catch (e) {
      console.error(e)
      alert('Error creating session')
    } finally {
      setIsCreating(false)
    }
  }

  const handleSelectSpace = async (spaceId: string) => {
    await fetch(`/api/spaces/${spaceId}/set-active`, { method: 'POST' })
    // Обновляем список сессий для нового пространства
    const res = await fetch('/api/sessions')
    if (res.ok) {
      const data = await res.json()
      setSessions(data.sessions || [])
    }
    router.refresh()
  }

  const handleCreateSpace = async () => {
    const name = prompt('Enter space name:')
    if (!name || !name.trim()) return

    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mode: 'SESSIONS_ONLY' }),
      })

      if (!res.ok) {
        throw new Error('Failed to create space')
      }

      const space = await res.json()
      await fetch(`/api/spaces/${space.id}/set-active`, { method: 'POST' })
      router.refresh()
    } catch (e) {
      console.error(e)
      alert('Error creating space')
    }
  }

  const handleRenameSpace = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        throw new Error('Failed to rename space')
      }

      router.refresh()
    } catch (e) {
      console.error(e)
      alert('Error renaming space')
    }
  }

  const handleDeleteSpace = async (id: string) => {
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const errorText = await res.text()
        if (errorText === 'LAST_SPACE') {
          alert('Cannot delete the last space')
          return
        }
        throw new Error('Failed to delete space')
      }

      router.refresh()
    } catch (e) {
      console.error(e)
      alert('Error deleting space')
    }
  }

  const handleDeleteSession = async (session: Session) => {
    if (!confirm('Are you sure you want to delete this session?')) {
      return
    }

    const sessionToDelete = session // Сохраняем для отката

    try {
      isDeletingRef.current = true // Устанавливаем флаг удаления
      setDeletingSessionId(session.id)
      // Оптимистичное обновление
      setSessions((prev) => prev.filter((s) => s.id !== session.id))
      
      const res = await fetch(`/api/sessions/${session.slug}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        // Откатываем изменения при ошибке
        setSessions((prev) => {
          const updated = [...prev, sessionToDelete]
          return updated.sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        })
        const errorText = await res.text()
        throw new Error(errorText || 'Failed to delete session')
      }

      // Успешное удаление - оставляем оптимистичное обновление
      // Не делаем лишний fetch, чтобы избежать race condition
    } catch (e) {
      console.error('Error deleting session:', e)
      alert(e instanceof Error ? e.message : 'Error deleting session')
    } finally {
      setDeletingSessionId(null)
      // Сбрасываем флаг удаления с небольшой задержкой, чтобы избежать race condition
      setTimeout(() => {
        isDeletingRef.current = false
      }, 500)
    }
  }

  const handleKillAllSessions = async () => {
    if (!confirm('Are you sure you want to delete ALL sessions? This action cannot be undone.')) {
      return
    }

    try {
      setIsKillingAll(true)
      const res = await fetch('/api/sessions/kill-all', {
        method: 'DELETE',
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || 'Failed to delete all sessions')
      }

      // Очищаем список сессий в UI
      setSessions([])
      router.refresh()
    } catch (e) {
      console.error('Error deleting all sessions:', e)
      alert(e instanceof Error ? e.message : 'Error deleting all sessions')
    } finally {
      setIsKillingAll(false)
    }
  }

  const uiSpaces: UISpace[] = spaces.map((space) => ({
    id: space.id,
    name: space.name,
    isActive: space.id === activeSpaceId,
  }))

  const activeSpace = uiSpaces.find((s) => s.isActive)

  return (
    <div className="min-h-screen bg-surface-900 text-white-900 relative">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 items-center">
            {/* Left: Workspace */}
            <button
              onClick={() => setIsWorkspaceModalOpen(true)}
              className="flex items-center gap-2 text-white-900 hover:opacity-60 transition-opacity"
            >
              <span>{activeSpace?.name || 'Workspace'}</span>
              <CaretDown size={16} weight="bold" />
            </button>

            {/* Center: Sessions */}
            <h1 className="text-sm text-white-900 text-center justify-self-center">sessions</h1>

            {/* Right: Avatar */}
            <div className="flex justify-end">
              <button
                onClick={() => setIsProfileModalOpen(true)}
                className="flex items-center"
              >
                <Avatar
                  userId={currentUser.id}
                  displayName={currentUser.displayName || currentUser.email}
                  avatarUrl={currentUser.avatarUrl}
                  noAvatarColor={currentUser.noAvatarColor}
                  size="sm"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-screen flex items-center justify-center pt-20 pb-20">
        <div className="w-full animate-fade-in-up">
          {activeSpaceMode === 'SESSIONS_AND_TASKS' && (
            <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
              <p className="text-sm text-white-600">
                Tasks are enabled in this space. You can track action items from your sessions.
              </p>
            </div>
          )}

          <div className="flex flex-col items-center gap-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => router.push(`/session/${session.slug}`)}
                className="text-white-900 hover:opacity-60 transition-opacity cursor-pointer"
              >
                Session {session.title || session.slug}
              </button>
            ))}
          </div>

          {sessions.length === 0 && (
            <div className="text-center py-12">
              <p className="text-white-600">No sessions yet. Create your first session to get started.</p>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8">
        <Button onClick={handleCreateSession} disabled={isCreating} variant="primary"  size="lg">
          {isCreating ? 'Creating...' : '+ session'}
        </Button>
      </div>

      {/* Workspace Modal */}
      {isWorkspaceModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setIsWorkspaceModalOpen(false)}
        >
          <div
            className="text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {uiSpaces.map((space) => (
              <div
                key={space.id}
                className="flex items-center justify-center gap-4 mb-4 group"
              >
                <button
                  onClick={() => {
                    handleSelectSpace(space.id)
                    setIsWorkspaceModalOpen(false)
                  }}
                  className="text-4xl text-white-900 hover:opacity-60 transition-opacity"
                >
                  {space.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const spaceData = spaces.find((s) => s.id === space.id)
                    const newName = prompt('Enter new name:', spaceData?.name || space.name)
                    if (newName && newName.trim()) {
                      handleRenameSpace(space.id, newName.trim())
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Rename"
                >
                  <Pencil size={24} weight="regular" className="text-white-900" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteSpace(space.id)
                    setIsWorkspaceModalOpen(false)
                  }}
                  disabled={uiSpaces.length === 1}
                  className="opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                  title={uiSpaces.length === 1 ? 'Cannot delete last space' : 'Delete'}
                >
                  <Trash size={24} weight="regular" className="text-white-900" />
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                handleCreateSpace()
                setIsWorkspaceModalOpen(false)
              }}
              className="block text-4xl text-white-500 hover:opacity-60 transition-opacity mt-8"
            >
              + Create new space
            </button>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {isProfileModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setIsProfileModalOpen(false)}
        >
          <div
            className="text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setIsEditModalOpen(true)
                setIsProfileModalOpen(false)
              }}
              className="block text-4xl text-white-900 hover:opacity-60 transition-opacity mb-4"
            >
              Profile
            </button>
            <button
              onClick={() => {
                handleKillAllSessions()
                setIsProfileModalOpen(false)
              }}
              disabled={isKillingAll || sessions.length === 0}
              className="block text-4xl text-white-900 hover:opacity-60 transition-opacity mb-4 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isKillingAll ? 'Deleting...' : 'Kill sessions'}
            </button>
            <button
              onClick={() => {
                signOut({ callbackUrl: '/' })
                setIsProfileModalOpen(false)
              }}
              className="block text-4xl text-white-900 hover:opacity-60 transition-opacity"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      <EditProfileModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        user={currentUser}
        onSave={(updatedUser) => {
          setCurrentUser(updatedUser)
          handleUserUpdate(updatedUser)
        }}
      />
    </div>
  )
}


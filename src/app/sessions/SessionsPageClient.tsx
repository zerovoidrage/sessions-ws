'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/shared/ui/button'
import { SpaceSwitcher, type UISpace } from '@/shared/ui/space-switcher/SpaceSwitcher'
import { SessionCard } from '@/shared/ui/session-card/SessionCard'
import { ProfileMenu } from '@/shared/ui/profile-menu/ProfileMenu'
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
  const isDeletingRef = useRef(false) // Флаг для предотвращения перезагрузки во время удаления

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

  return (
    <div className="min-h-screen bg-surface-900 text-white-900">
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">Sessions</h1>
          <div className="flex items-center gap-3">
            <Button 
              onClick={handleKillAllSessions} 
              disabled={isKillingAll || sessions.length === 0}
              variant="ghost"
              size="sm"
            >
              {isKillingAll ? 'Deleting...' : 'Kill sessions'}
            </Button>
            <ProfileMenu user={currentUser} onUserUpdate={handleUserUpdate} />
          </div>
        </div>

        <div className="mb-6">
          <SpaceSwitcher
            spaces={uiSpaces}
            onSelectSpace={handleSelectSpace}
            onCreateSpace={handleCreateSpace}
            onRenameSpace={handleRenameSpace}
            onDeleteSpace={handleDeleteSpace}
          />
        </div>

        {activeSpaceMode === 'SESSIONS_AND_TASKS' && (
          <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-white-600">
              Tasks are enabled in this space. You can track action items from your sessions.
            </p>
          </div>
        )}

        <div className="mb-6">
          <Button onClick={handleCreateSession} disabled={isCreating} variant="primary">
            {isCreating ? 'Creating...' : 'Create session'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              slug={session.slug}
              title={session.title}
              createdAt={session.createdAt}
              status={session.status}
              onClick={() => router.push(`/session/${session.slug}`)}
              onDelete={() => handleDeleteSession(session)}
            />
          ))}
        </div>

        {sessions.length === 0 && (
          <div className="text-center py-12">
            <p className="text-white-600">No sessions yet. Create your first session to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}


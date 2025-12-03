'use client'

import { useState } from 'react'
import { Button } from '../button'
import { Input } from '../input'
import { CaretDown, Plus, Pencil, Trash } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export type UISpace = {
  id: string
  name: string
  isActive: boolean
}

export interface SpaceSwitcherProps {
  spaces: UISpace[]
  onSelectSpace: (id: string) => void
  onCreateSpace: () => void
  onRenameSpace: (id: string, name: string) => void
  onDeleteSpace: (id: string) => void
}

export function SpaceSwitcher({
  spaces,
  onSelectSpace,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
}: SpaceSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const activeSpace = spaces.find((s) => s.isActive)

  const handleRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditName(currentName)
  }

  const handleRenameSubmit = (id: string) => {
    if (editName.trim()) {
      onRenameSpace(id, editName.trim())
    }
    setEditingId(null)
    setEditName('')
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this space?')) {
      onDeleteSpace(id)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white-900 text-callout hover:bg-white/10 transition-colors"
          >
            <span>{activeSpace?.name || 'Select space'}</span>
            <CaretDown size={16} weight="bold" />
          </button>

          {isOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsOpen(false)}
              />
              <div className="absolute top-full left-0 mt-2 w-64 bg-surface-800 border border-white/10 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
                {spaces.map((space) => (
                  <div
                    key={space.id}
                    className={cn(
                      'px-3 py-2 hover:bg-white/5 flex items-center justify-between group',
                      space.isActive && 'bg-white/5'
                    )}
                  >
                    {editingId === space.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleRenameSubmit(space.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleRenameSubmit(space.id)
                            } else if (e.key === 'Escape') {
                              setEditingId(null)
                              setEditName('')
                            }
                          }}
                          autoFocus
                          className="flex-1"
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSpace(space.id)
                            setIsOpen(false)
                          }}
                          className="flex-1 text-left text-callout text-white-900"
                        >
                          {space.name}
                        </button>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleRename(space.id, space.name)}
                            className="p-1 hover:bg-white/10 rounded"
                            title="Rename"
                          >
                            <Pencil size={14} weight="regular" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleDelete(space.id)
                              setIsOpen(false)
                            }}
                            disabled={spaces.length === 1}
                            className="p-1 hover:bg-white/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                            title={spaces.length === 1 ? 'Cannot delete last space' : 'Delete'}
                          >
                            <Trash size={14} weight="regular" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div className="border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      onCreateSpace()
                      setIsOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-callout text-white-700 hover:bg-white/5 flex items-center gap-2"
                  >
                    <Plus size={16} weight="bold" />
                    <span>Create new space...</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


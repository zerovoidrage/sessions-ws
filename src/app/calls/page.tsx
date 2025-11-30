'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/shared/ui/button'

export default function CallsPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleCreateCall = async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/calls', {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error('Failed to create room')
      }

      const data = await res.json()
      router.push(`/call/${data.slug}`)
    } catch (e) {
      console.error(e)
      alert('Error creating call')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-900 text-white-900">
      <div className="rounded-2xl border border-onsurface-900 bg-white/5 p-28 shadow-xl max-w-md w-full text-center">
      <p className="text-xs text-white-500 mb-20">
          12rooms
        </p>
        <p className="text-xs text-white-900 mb-20">
          Create a new call room and share the link with others.
        </p>
        <Button
          onClick={handleCreateCall}
          disabled={isLoading}
          variant="primary"
          size="md"
        >
          {isLoading ? 'Creating...' : 'Create call'}
        </Button>
      </div>
    </div>
  )
}




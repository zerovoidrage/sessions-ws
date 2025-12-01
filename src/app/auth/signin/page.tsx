'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { Button } from '@/shared/ui/button'

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    try {
      setIsLoading(true)
      await signIn('google', { 
        callbackUrl: '/sessions',
        redirect: true,
      })
    } catch (error) {
      console.error('Sign in error:', error)
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
          Sign in to continue
        </p>
        <Button
          onClick={handleSignIn}
          disabled={isLoading}
          variant="primary"
          size="md"
          className="w-full"
        >
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </Button>
      </div>
    </div>
  )
}


/**
 * Cached data loaders for user entities.
 * Uses React cache() to deduplicate requests within a single render pass.
 */

import { cache } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '../infra/auth.config'
import { findById } from '../infra/user.repository'
import type { DomainUser } from '../domain/user.types'

/**
 * Gets the current authenticated user (cached per request).
 * Returns null if not authenticated.
 */
export const getCurrentUserCached = cache(async (): Promise<DomainUser | null> => {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return null
  }

  return findById(session.user.id)
})

/**
 * Gets a user by ID (cached per request).
 */
export const getUserByIdCached = cache(async (userId: string): Promise<DomainUser | null> => {
  return findById(userId)
})


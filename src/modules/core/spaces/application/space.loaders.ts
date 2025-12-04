/**
 * Cached data loaders for space entities.
 * Uses React cache() to deduplicate requests within a single render pass.
 */

import { cache } from 'react'
import { listByUser, getById } from '../infra/spaces.repository'
import type { Space } from '../domain/space.types'

/**
 * Lists all spaces for a user (cached per request).
 * Always include userId in cache key to ensure per-user caching and prevent cross-user data leaks.
 */
export const listSpacesForUserCached = cache(async (userId: string): Promise<Space[]> => {
  return listByUser(userId)
})

/**
 * Gets a space by ID (cached per request).
 */
export const getSpaceByIdCached = cache(async (spaceId: string): Promise<Space | null> => {
  return getById(spaceId)
})

/**
 * Gets the active space for a user (cached per request).
 * Requires user object with activeSpaceId.
 */
export const getActiveSpaceCached = cache(async (userId: string, activeSpaceId: string | null): Promise<Space | null> => {
  if (!activeSpaceId) {
    return null
  }
  return getById(activeSpaceId)
})


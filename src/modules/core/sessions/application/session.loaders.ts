/**
 * Cached data loaders for session entities.
 * Uses React cache() to deduplicate requests within a single render pass.
 */

import { cache } from 'react'
import { getSessionBySlug as getSessionBySlugRepo, listSessionsBySpace as listSessionsBySpaceRepo, getSessionById as getSessionByIdRepo } from '../infra/prisma/sessions.repository'
import type { GetSessionBySlugInput, Session } from '../domain/session.types'

/**
 * Gets a session by slug (cached per request).
 * Always include slug in cache key to ensure per-session caching.
 */
export const getSessionBySlugCached = cache(async (slug: string): Promise<Session | null> => {
  return getSessionBySlugRepo({ slug })
})

/**
 * Gets a session by ID (cached per request).
 */
export const getSessionByIdCached = cache(async (sessionId: string): Promise<Session | null> => {
  return getSessionByIdRepo(sessionId)
})

/**
 * Lists sessions for a space (cached per request).
 * Always include spaceId in cache key to ensure per-space caching and prevent cross-user data leaks.
 */
export const listSessionsBySpaceCached = cache(async (spaceId: string): Promise<Session[]> => {
  return listSessionsBySpaceRepo(spaceId)
})


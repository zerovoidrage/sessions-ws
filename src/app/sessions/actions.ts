/**
 * Server Actions for sessions page.
 * These actions are called directly from client components, reducing boilerplate.
 */

'use server'

import { getCurrentUserCached } from '@/modules/core/identity/application/user.loaders'
import { createSession } from '@/modules/core/sessions/application/createSession'
import { endSession } from '@/modules/core/sessions/application/endSession'
import { deleteSession } from '@/modules/core/sessions/application/deleteSession'
import { getSessionBySlugCached } from '@/modules/core/sessions/application/session.loaders'

export interface CreateSessionActionResult {
  success: boolean
  slug?: string
  error?: string
}

/**
 * Creates a new session from UI.
 */
export async function createSessionAction(formData: FormData): Promise<CreateSessionActionResult> {
  try {
    const user = await getCurrentUserCached()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const title = formData.get('title')?.toString() ?? ''
    const spaceId = formData.get('spaceId')?.toString() ?? user.activeSpaceId

    if (!spaceId) {
      return { success: false, error: 'No active space' }
    }

    const session = await createSession({
      title: title || undefined,
      spaceId,
      createdByUserId: user.id,
    })

    return { success: true, slug: session.slug }
  } catch (error) {
    console.error('[createSessionAction] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create session',
    }
  }
}

export interface EndSessionActionResult {
  success: boolean
  error?: string
}

/**
 * Ends a session from UI.
 */
export async function endSessionAction(slug: string): Promise<EndSessionActionResult> {
  try {
    const user = await getCurrentUserCached()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const session = await getSessionBySlugCached(slug)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    // endSession expects sessionId and endedByUserId
    await endSession(session.id, user.id)

    return { success: true }
  } catch (error) {
    console.error('[endSessionAction] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to end session',
    }
  }
}

export interface DeleteSessionActionResult {
  success: boolean
  error?: string
}

/**
 * Deletes a session from UI.
 */
export async function deleteSessionAction(slug: string): Promise<DeleteSessionActionResult> {
  try {
    const user = await getCurrentUserCached()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const session = await getSessionBySlugCached(slug)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    // deleteSession expects userId and sessionId
    await deleteSession({
      userId: user.id,
      sessionId: session.id,
    })

    return { success: true }
  } catch (error) {
    console.error('[deleteSessionAction] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete session',
    }
  }
}


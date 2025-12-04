/**
 * Server Actions for session page.
 */

'use server'

import { getCurrentUserCached } from '@/modules/core/identity/application/user.loaders'
import { endSession } from '@/modules/core/sessions/application/endSession'
import { getSessionBySlugCached } from '@/modules/core/sessions/application/session.loaders'

export interface EndSessionActionResult {
  success: boolean
  error?: string
}

/**
 * Ends a session from the session page UI.
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


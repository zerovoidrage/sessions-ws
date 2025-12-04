/**
 * Server Actions for dashboard (spaces, profile, etc.).
 */

'use server'

import { getCurrentUserCached } from '@/modules/core/identity/application/user.loaders'
import { setActiveSpaceForUser } from '@/modules/core/spaces/application/setActiveSpaceForUser'
import { updateProfile } from '@/modules/core/identity/application/updateProfile'

export interface SetActiveSpaceActionResult {
  success: boolean
  error?: string
}

/**
 * Sets the active space for the current user.
 */
export async function setActiveSpaceAction(spaceId: string): Promise<SetActiveSpaceActionResult> {
  try {
    const user = await getCurrentUserCached()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    await setActiveSpaceForUser(user.id, spaceId)
    return { success: true }
  } catch (error) {
    console.error('[setActiveSpaceAction] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set active space',
    }
  }
}

export interface UpdateProfileActionResult {
  success: boolean
  error?: string
}

/**
 * Updates user profile.
 */
export async function updateProfileAction(formData: FormData): Promise<UpdateProfileActionResult> {
  try {
    const user = await getCurrentUserCached()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const displayName = formData.get('displayName')?.toString()
    const avatarUrl = formData.get('avatarUrl')?.toString()

    await updateProfile(
      user.id,
      {
        displayName: displayName || undefined,
        avatarUrl: avatarUrl || undefined,
      }
    )

    return { success: true }
  } catch (error) {
    console.error('[updateProfileAction] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update profile',
    }
  }
}


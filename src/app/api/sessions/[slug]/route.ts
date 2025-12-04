/**
 * GET /api/sessions/[slug]
 * 
 * Returns session data including AI metadata.
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getUserRoleInSpace } from '@/modules/core/spaces/infra/spaces.repository'
import { handleApiError } from '@/lib/http/handleApiError'

interface Params {
  params: Promise<{ slug: string }>
}

export async function GET(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return handleApiError(new Error('UNAUTHORIZED'))
    }

    const { slug } = await params
    if (!slug) {
      return handleApiError(new Error('INVALID_INPUT: Missing session slug'))
    }

    const session = await getSessionBySlug({ slug })
    if (!session) {
      return handleApiError(new Error('NOT_FOUND: Session not found'))
    }

    // Check user has access to the space
    const role = await getUserRoleInSpace(user.id, session.spaceId)
    if (!role) {
      return handleApiError(new Error('FORBIDDEN: Access denied'))
    }

    return NextResponse.json(session)
  } catch (error) {
    return handleApiError(error)
  }
}

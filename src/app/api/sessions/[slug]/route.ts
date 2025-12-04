/**
 * GET /api/sessions/[slug]
 * 
 * Returns session data including AI metadata.
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getUserRoleInSpace } from '@/modules/core/spaces/infra/spaces.repository'

interface Params {
  params: Promise<{ slug: string }>
}

export async function GET(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Missing session slug' }, { status: 400 })
    }

    const session = await getSessionBySlug({ slug })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Check user has access to the space
    const role = await getUserRoleInSpace(user.id, session.spaceId)
    if (!role) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(session)
  } catch (error) {
    console.error('[GET /api/sessions/[slug]] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

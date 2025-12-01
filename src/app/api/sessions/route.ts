import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { ensureUserHasAtLeastOneSpace } from '@/modules/core/spaces/application/ensureUserHasAtLeastOneSpace'
import { listSpacesForUser } from '@/modules/core/spaces/application/listSpacesForUser'
import { createSessionEndpoint } from '@/modules/core/sessions/api/createSessionEndpoint'
import { listSessionsEndpoint } from '@/modules/core/sessions/api/listSessionsEndpoint'

// GET /api/sessions
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }

    await ensureUserHasAtLeastOneSpace(user.id)

    const spaces = await listSpacesForUser(user.id)
    const activeSpaceId = user.activeSpaceId || spaces[0]?.id

    if (!activeSpaceId) {
      return NextResponse.json({ sessions: [] })
    }

    const sessions = await listSessionsEndpoint(user, activeSpaceId)

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Error listing sessions:', error)
    return new NextResponse('Failed to list sessions', { status: 500 })
  }
}

// POST /api/sessions
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }

    const body = await req.json()
    const { title, spaceId } = body

    const finalSpaceId = spaceId || user.activeSpaceId
    if (!finalSpaceId) {
      return new NextResponse('NO_ACTIVE_SPACE', { status: 400 })
    }

    const session = await createSessionEndpoint(user, {
      title,
      spaceId: finalSpaceId,
    })

    return NextResponse.json({ slug: session.slug })
  } catch (error) {
    console.error('Error creating session:', error)
    return new NextResponse('Failed to create session', { status: 500 })
  }
}

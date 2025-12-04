import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { ensureUserHasAtLeastOneSpace } from '@/modules/core/spaces/application/ensureUserHasAtLeastOneSpace'
import { listSpacesForUser } from '@/modules/core/spaces/application/listSpacesForUser'
import { createSessionEndpoint } from '@/modules/core/sessions/api/createSessionEndpoint'
import { listSessionsEndpoint } from '@/modules/core/sessions/api/listSessionsEndpoint'
import { withRateLimit, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit'
import { handleApiError } from '@/lib/http/handleApiError'

// GET /api/sessions
export async function GET(req: Request) {
  // Rate limiting
  const rateLimitResponse = await withRateLimit(RATE_LIMIT_CONFIGS.default)(req)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const user = await getCurrentUser()
    if (!user) {
      return handleApiError(new Error('UNAUTHORIZED'))
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
    return handleApiError(error)
  }
}

// POST /api/sessions
export async function POST(req: Request) {
  // Rate limiting (строже для создания)
  const rateLimitResponse = await withRateLimit(RATE_LIMIT_CONFIGS.create)(req)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const user = await getCurrentUser()
    if (!user) {
      return handleApiError(new Error('UNAUTHORIZED'))
    }

    const body = await req.json()
    const { title, spaceId } = body

    const finalSpaceId = spaceId || user.activeSpaceId
    if (!finalSpaceId) {
      return handleApiError(new Error('INVALID_INPUT: No active space'))
    }

    const session = await createSessionEndpoint(user, {
      title,
      spaceId: finalSpaceId,
    })

    return NextResponse.json({ slug: session.slug })
  } catch (error) {
    return handleApiError(error)
  }
}

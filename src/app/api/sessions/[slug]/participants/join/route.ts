import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { upsertParticipantOnJoinEndpoint } from '@/modules/core/sessions/api/upsertParticipantOnJoinEndpoint'

interface Params {
  params: Promise<{ slug: string }>
}

// POST /api/sessions/[slug]/participants/join
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    const { slug } = await params
    const body = await req.json()

    const { identity, name, role, isGuest } = body

    if (!identity || typeof identity !== 'string') {
      return new NextResponse('Missing or invalid identity', { status: 400 })
    }

    // Если это гость (неавторизованный пользователь)
    if (!user && isGuest && role === 'GUEST') {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return new NextResponse('Name is required for guest', { status: 400 })
      }

      const participant = await upsertParticipantOnJoinEndpoint(null, {
        sessionSlug: slug,
        identity,
        name: name.trim(),
        role: 'GUEST',
      })

      return NextResponse.json(participant)
    }

    // Для авторизованных пользователей
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }

    const participant = await upsertParticipantOnJoinEndpoint(user, {
      sessionSlug: slug,
      identity,
      name: name || user.displayName || undefined,
    })

    return NextResponse.json(participant)
  } catch (error) {
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return new NextResponse('Session not found', { status: 404 })
    }
    console.error('Error joining participant:', error)
    return new NextResponse('Failed to join participant', { status: 500 })
  }
}



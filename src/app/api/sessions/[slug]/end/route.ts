import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { endSessionEndpoint } from '@/modules/core/sessions/api/endSessionEndpoint'

interface Params {
  params: Promise<{ slug: string }>
}

// POST /api/sessions/[slug]/end
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    const { slug } = await params

    await endSessionEndpoint(user, slug)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('UNAUTHORIZED')) {
        return new NextResponse('UNAUTHORIZED', { status: 401 })
      }
      if (error.message.includes('NOT_FOUND')) {
        return new NextResponse('Session not found', { status: 404 })
      }
      if (error.message.includes('FORBIDDEN')) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
    console.error('Error ending session:', error)
    return new NextResponse('Failed to end session', { status: 500 })
  }
}



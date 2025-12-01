import { NextResponse } from 'next/server'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getActiveParticipantsBySessionId } from '@/modules/core/sessions/infra/participants/participants.repository'

interface Params {
  params: Promise<{ slug: string }>
}

// GET /api/sessions/[slug]/participants
// Возвращает список всех активных участников сессии из БД
export async function GET(req: Request, { params }: Params) {
  try {
    const { slug } = await params

    const session = await getSessionBySlug({ slug })
    if (!session) {
      return new NextResponse('Session not found', { status: 404 })
    }

    const participants = await getActiveParticipantsBySessionId(session.id)

    return NextResponse.json({ participants })
  } catch (error) {
    console.error('Error listing participants:', error)
    return new NextResponse('Failed to list participants', { status: 500 })
  }
}



import { NextResponse } from 'next/server'
import { selectNewTranscriptionHostEndpoint } from '@/modules/core/sessions/api/selectNewTranscriptionHostEndpoint'

interface Params {
  params: Promise<{ slug: string }>
}

/**
 * POST /api/sessions/[slug]/transcription-host
 * 
 * Выбрать нового transcription host для сессии.
 * Вызывается когда текущий host уходит из комнаты.
 * 
 * Body: { excludeIdentity?: string } - identity участника, который ушел
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const { slug } = await params
    const body = await req.json().catch(() => ({}))
    const excludeIdentity = body.excludeIdentity || undefined

    const result = await selectNewTranscriptionHostEndpoint({
      sessionSlug: slug,
      excludeIdentity,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[POST /api/sessions/[slug]/transcription-host] Error:', error)
    
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return new NextResponse('Session not found', { status: 404 })
    }

    return new NextResponse('Failed to select new transcription host', { status: 500 })
  }
}


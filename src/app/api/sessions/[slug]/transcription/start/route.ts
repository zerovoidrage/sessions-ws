import { NextResponse } from 'next/server'
import { startTranscriptionServiceEndpoint } from '@/modules/core/sessions/api/startTranscriptionServiceEndpoint'

interface Params {
  params: { slug: string }
}

/**
 * POST /api/sessions/[slug]/transcription/start
 * 
 * Запускает серверную транскрипцию для сессии.
 * 
 * ВАЖНО: Полная реализация требует настройки WebRTC в Node.js.
 * Пока это заглушка - транскрипция работает на клиенте.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const { slug } = params

    const result = await startTranscriptionServiceEndpoint(slug)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[POST /api/sessions/[slug]/transcription/start] Error:', error)
    
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return new NextResponse('Session not found', { status: 404 })
    }

    return new NextResponse('Failed to start transcription service', { status: 500 })
  }
}


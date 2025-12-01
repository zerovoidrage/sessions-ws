import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/modules/core/identity/infra/auth.config'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { generateToken, generateTranscriptionToken } from '@/modules/core/sessions/infra/livekit/token.service'

interface Params {
  params: Promise<{ slug: string }>
}

// GET /api/sessions/[slug]/token?name=DisplayName
export async function GET(req: Request, { params }: Params) {
  try {
    const { slug } = await params

    const session = await getSessionBySlug({ slug })

    if (!session) {
      return new NextResponse('Session not found', { status: 404 })
    }

    const url = new URL(req.url)
    const nameParam = url.searchParams.get('name')?.trim() || ''
    const identityParam = url.searchParams.get('identity')?.trim()

    // Пытаемся получить данные пользователя из сессии
    const authSession = await getServerSession(authOptions)
    const userDisplayName = authSession?.user?.displayName || ''
    const userId = authSession?.user?.id

    // Приоритет: displayName из сессии > параметр name из URL
    const displayName = userDisplayName || nameParam

    // Генерируем стабильный identity:
    // - если передан identity в query (для гостей) - используем его
    // - для авторизованных пользователей: userId:sessionId (стабильный)
    // - для новых гостей: guest-slug-random (случайный)
    const identity = identityParam || (userId
      ? `${userId}:${session.id}`
      : `guest-${slug}-${Math.random().toString(36).slice(2, 8)}`)

    const tokenResult = await generateToken({
      sessionSlug: session.slug, // roomName = slug (строго)
      identity,
      name: displayName || undefined,
    })

    // Генерируем transcription token для WebSocket авторизации
    const transcriptionTokenResult = await generateTranscriptionToken({
      sessionSlug: session.slug,
      userId: userId || undefined,
      identity,
    })

    return NextResponse.json({
      ...tokenResult,
      transcriptionToken: transcriptionTokenResult.transcriptionToken,
      sessionCreatedByUserId: session.createdByUserId || null, // Для определения designated host
    })
  } catch (error) {
    console.error('Error generating token:', error)
    return new NextResponse('Failed to generate token', { status: 500 })
  }
}

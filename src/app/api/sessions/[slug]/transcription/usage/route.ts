import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/modules/core/identity/infra/auth.config'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getTranscriptionUsageBySession } from '@/modules/core/sessions/infra/transcription/transcription-usage.repository'

interface Params {
  params: { slug: string }
}

/**
 * GET /api/sessions/[slug]/transcription/usage
 * 
 * Получает статистику использования транскрипции для сессии
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const authSession = await getServerSession(authOptions)
    if (!authSession?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { slug } = params

    const session = await getSessionBySlug({ slug })
    if (!session) {
      return new NextResponse('Session not found', { status: 404 })
    }

    const usage = await getTranscriptionUsageBySession(session.id)

    // Агрегируем статистику
    const totalMinutes = usage.reduce((sum, u) => sum + u.durationMinutes, 0)
    const totalCost = usage.reduce((sum, u) => sum + u.totalCost, 0)
    const totalSessions = usage.length

    return NextResponse.json({
      usage,
      stats: {
        totalMinutes,
        totalCost,
        totalSessions,
        averageDurationMinutes: totalSessions > 0 ? totalMinutes / totalSessions : 0,
      },
    })
  } catch (error) {
    console.error('[GET /api/sessions/[slug]/transcription/usage] Error:', error)
    return new NextResponse('Failed to get transcription usage', { status: 500 })
  }
}


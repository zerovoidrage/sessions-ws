import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/modules/core/identity/infra/auth.config'
import { getTranscriptionStatsByUser } from '@/modules/core/sessions/infra/transcription/transcription-usage.repository'

/**
 * GET /api/transcription/stats
 * 
 * Получает статистику использования транскрипции для текущего пользователя
 */
export async function GET() {
  try {
    const authSession = await getServerSession(authOptions)
    if (!authSession?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const stats = await getTranscriptionStatsByUser(authSession.user.id)

    return NextResponse.json(stats)
  } catch (error) {
    console.error('[GET /api/transcription/stats] Error:', error)
    return new NextResponse('Failed to get transcription stats', { status: 500 })
  }
}


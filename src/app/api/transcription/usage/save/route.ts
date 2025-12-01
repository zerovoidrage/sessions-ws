import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/modules/core/identity/infra/auth.config'
import { saveTranscriptionUsage } from '@/modules/core/sessions/application/saveTranscriptionUsage'

/**
 * POST /api/transcription/usage/save
 * 
 * Сохраняет информацию об использовании транскрипции в БД
 */
export async function POST(req: Request) {
  try {
    const authSession = await getServerSession(authOptions)
    const body = await req.json()
    const {
      sessionSlug,
      participantIdentity,
      userId,
      startedAt,
      endedAt,
      durationSeconds,
      durationMinutes,
      audioChunksSent,
      transcriptsReceived,
      finalTranscripts,
      partialTranscripts,
      errorsCount,
    } = body

    // Для гостей userId может быть null/undefined
    // Для авторизованных пользователей используем userId из запроса или текущего пользователя
    const finalUserId = userId || authSession?.user?.id || null

    await saveTranscriptionUsage({
      sessionSlug,
      participantIdentity,
      userId: finalUserId,
      startedAt: new Date(startedAt),
      endedAt: endedAt ? new Date(endedAt) : undefined,
      durationSeconds,
      durationMinutes,
      audioChunksSent,
      transcriptsReceived,
      finalTranscripts,
      partialTranscripts,
      errorsCount,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POST /api/transcription/usage/save] Error:', error)
    return new NextResponse('Failed to save transcription usage', { status: 500 })
  }
}


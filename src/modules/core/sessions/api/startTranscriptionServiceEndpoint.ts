/**
 * API endpoint для запуска серверной транскрипции для сессии.
 * 
 * ВАЖНО: Полная реализация требует настройки WebRTC в Node.js окружении.
 * Пока это заглушка для будущей реализации.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/modules/core/identity/infra/auth.config'
import { getSessionBySlug } from '../application/getSessionBySlug'
import { livekitEnv } from '@/lib/env/livekit'

export async function startTranscriptionServiceEndpoint(sessionSlug: string) {
  const authSession = await getServerSession(authOptions)
  if (!authSession?.user?.id) {
    throw new Error('UNAUTHORIZED')
  }

  const session = await getSessionBySlug({ slug: sessionSlug })
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // TODO: Запустить transcription-service для этой сессии
  // const transcriptionService = new TranscriptionService({
  //   roomName: session.slug,
  //   sessionSlug: session.slug,
  //   serverUrl: livekitEnv.wsUrl,
  //   apiKey: livekitEnv.apiKey!,
  //   apiSecret: livekitEnv.apiSecret!,
  // })
  // await transcriptionService.start()

  return {
    success: true,
    message: 'Transcription service started (placeholder)',
    sessionSlug,
  }
}


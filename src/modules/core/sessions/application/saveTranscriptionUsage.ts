import { getSessionBySlug } from './getSessionBySlug'
import { createTranscriptionUsage } from '../infra/transcription/transcription-usage.repository'

interface SaveTranscriptionUsageInput {
  sessionSlug: string
  participantIdentity?: string
  userId?: string
  startedAt: Date
  endedAt?: Date
  durationSeconds: number
  durationMinutes: number
  audioChunksSent?: number
  transcriptsReceived?: number
  finalTranscripts?: number
  partialTranscripts?: number
  costPerMinute?: number
  errorsCount?: number
}

/**
 * Сохраняет информацию об использовании транскрипции в БД
 */
export async function saveTranscriptionUsage(
  input: SaveTranscriptionUsageInput
): Promise<void> {
  // Получаем сессию по slug
  const session = await getSessionBySlug({ slug: input.sessionSlug })
  if (!session) {
    console.warn('[saveTranscriptionUsage] Session not found', {
      sessionSlug: input.sessionSlug,
    })
    return
  }

  // Получаем participantId по identity (если есть)
  let participantId: string | undefined = undefined
  if (input.participantIdentity) {
    const { getParticipantWithUserByIdentity } = await import('../infra/participants/participants.repository')
    const participant = await getParticipantWithUserByIdentity(session.id, input.participantIdentity)
    participantId = participant?.id
  }

  // Стоимость за минуту (можно вынести в конфиг или env)
  const costPerMinute = input.costPerMinute || parseFloat(process.env.TRANSCRIPTION_COST_PER_MINUTE || '0.01')

  // Сохраняем использование
  await createTranscriptionUsage({
    videoSessionId: session.id,
    participantId: participantId || null,
    userId: input.userId || null,
    startedAt: input.startedAt,
    endedAt: input.endedAt || null,
    durationSeconds: input.durationSeconds,
    durationMinutes: input.durationMinutes,
    audioChunksSent: input.audioChunksSent || 0,
    transcriptsReceived: input.transcriptsReceived || 0,
    finalTranscripts: input.finalTranscripts || 0,
    partialTranscripts: input.partialTranscripts || 0,
    costPerMinute,
    errorsCount: input.errorsCount || 0,
  })

  console.log('[saveTranscriptionUsage] Transcription usage saved', {
    sessionSlug: input.sessionSlug,
    durationMinutes: input.durationMinutes,
    totalCost: input.durationMinutes * costPerMinute,
  })
}


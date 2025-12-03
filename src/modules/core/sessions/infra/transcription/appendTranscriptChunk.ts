import { getSessionBySlug } from '../../application/getSessionBySlug'
import { upsertParticipantOnJoin } from '../../application/upsertParticipantOnJoin'
import { upsertTranscriptSegmentByUtterance } from '../prisma/transcripts.repository'
import type { AppendTranscriptChunkInput } from './transcript.types'

export async function appendTranscriptChunk(input: AppendTranscriptChunkInput): Promise<void> {
  // ВАЛИДАЦИЯ: В БД сохраняем только финальные сегменты
  // Partial-ы отправляются клиенту для UI, но не сохраняются в БД
  // Это критично для масштабируемости (снижение нагрузки в 50-100 раз)
  if (!input.isFinal) {
    console.warn('[appendTranscriptChunk] Attempted to save partial transcript to DB, skipping', {
      sessionSlug: input.sessionSlug,
      utteranceId: input.utteranceId,
      textLength: input.text.length,
    })
    return
  }

  // 1. Найти session по slug
  const session = await getSessionBySlug({ slug: input.sessionSlug })
  if (!session) {
    throw new Error(`Session not found: ${input.sessionSlug}`)
  }

  // 2. Найти/создать participant по identity (если есть)
  // Используем тот же use-case, что и при подключении к комнате, чтобы не дублировать код
  let participantId: string | null = null
  if (input.participantIdentity) {
    const participant = await upsertParticipantOnJoin({
      sessionId: session.id,
      identity: input.participantIdentity,
      name: input.participantIdentity, // Можно улучшить, получая имя из LiveKit
      role: 'GUEST',
      userId: null, // При транскрипте userId может быть неизвестен
    })
    participantId = participant.id
  }

  // 3. upsert TranscriptSegment по (sessionId, utteranceId)
  await upsertTranscriptSegmentByUtterance({
    ...input,
    sessionId: session.id,
    participantId,
  })
}


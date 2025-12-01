import { db } from './db.js'

export interface AppendTranscriptChunkInput {
  sessionSlug: string
  participantIdentity?: string
  utteranceId: string
  text: string
  isFinal: boolean
  startedAt: Date
  endedAt?: Date
}

/**
 * Сохраняет финальный транскрипт в БД.
 * Для WebSocket сервера - упрощенная версия без зависимостей от основного проекта.
 */
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

  try {
    // 1. Найти session по slug
    const session = await db.videoSession.findUnique({
      where: { slug: input.sessionSlug },
    })

    if (!session) {
      throw new Error(`Session not found: ${input.sessionSlug}`)
    }

    // 2. Найти/создать participant по identity (если есть)
    let participantId: string | null = null
    if (input.participantIdentity) {
      const participant = await db.participant.upsert({
        where: {
          videoSessionId_identity: {
            videoSessionId: session.id,
            identity: input.participantIdentity,
          },
        },
        create: {
          videoSessionId: session.id,
          identity: input.participantIdentity,
          name: input.participantIdentity, // Используем identity как имя по умолчанию
          role: 'GUEST',
          userId: null,
        },
        update: {
          name: input.participantIdentity, // Обновляем имя если изменилось
        },
      })
      participantId = participant.id
    }

    // 3. upsert TranscriptSegment по (sessionId, utteranceId)
    await db.transcriptSegment.upsert({
      where: {
        videoSessionId_utteranceId: {
          videoSessionId: session.id,
          utteranceId: input.utteranceId,
        },
      },
      create: {
        videoSessionId: session.id,
        participantId,
        utteranceId: input.utteranceId,
        text: input.text,
        isFinal: true,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
      update: {
        text: input.text,
        isFinal: true,
        endedAt: input.endedAt,
      },
    })

    console.log('[appendTranscriptChunk] Transcript saved successfully', {
      sessionSlug: input.sessionSlug,
      utteranceId: input.utteranceId,
      textLength: input.text.length,
    })
  } catch (error) {
    console.error('[appendTranscriptChunk] Error saving transcript:', error)
    throw error
  }
}


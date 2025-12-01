import { db } from '@/lib/db'
import type { TranscriptSegment, AppendTranscriptChunkInput, ListTranscriptsBySessionInput } from '../domain/transcript.types'

export async function upsertTranscriptSegmentByUtterance(input: AppendTranscriptChunkInput & { sessionId: string; participantId?: string | null }): Promise<TranscriptSegment> {
  const segment = await db.transcriptSegment.upsert({
    where: {
      videoSessionId_utteranceId: {
        videoSessionId: input.sessionId,
        utteranceId: input.utteranceId,
      },
    },
    create: {
      videoSessionId: input.sessionId,
      participantId: input.participantId,
      utteranceId: input.utteranceId,
      text: input.text,
      isFinal: input.isFinal,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    },
    update: {
      text: input.text,
      isFinal: input.isFinal,
      endedAt: input.endedAt,
    },
  })

  return {
    id: segment.id,
    sessionId: segment.videoSessionId,
    participantId: segment.participantId,
    utteranceId: segment.utteranceId,
    text: segment.text,
    language: segment.language,
    isFinal: segment.isFinal,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    createdAt: segment.createdAt,
  }
}

export async function listTranscriptsBySession(input: ListTranscriptsBySessionInput): Promise<TranscriptSegment[]> {
  const session = await db.videoSession.findUnique({
    where: { slug: input.sessionSlug },
    include: {
      transcripts: {
        orderBy: { startedAt: 'asc' },
      },
    },
  })

  if (!session) {
    return []
  }

  return session.transcripts.map((t) => ({
    id: t.id,
    sessionId: t.videoSessionId,
    participantId: t.participantId,
    utteranceId: t.utteranceId,
    text: t.text,
    language: t.language,
    isFinal: t.isFinal,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    createdAt: t.createdAt,
  }))
}


/**
 * Use-case: финализация и сохранение сырого транскрипта сессии в Vercel Blob Storage.
 * 
 * Собирает все финальные транскрипты сессии, формирует JSON и сохраняет в Blob.
 * Обновляет метаданные сессии (rawTranscriptBlobUrl, rawTranscriptSizeBytes, rawTranscriptReadyAt).
 * 
 * Если транскрипт уже сохранён (rawTranscriptBlobUrl существует), перезаписывает его.
 */

import { put } from '@vercel/blob'
import { db } from '@/lib/db'

export interface FinalizeSessionTranscriptResult {
  blobUrl: string
  sizeBytes: number
  segmentsCount: number
}

export async function finalizeSessionTranscript(
  sessionId: string
): Promise<FinalizeSessionTranscriptResult | null> {
  // 1. Получаем сессию с финальными транскриптами
  const session = await db.videoSession.findUnique({
    where: { id: sessionId },
    include: {
      transcriptSegments: {
        where: { isFinal: true },
        orderBy: { startedAt: 'asc' },
        include: {
          participant: {
            include: {
              user: true, // Для получения displayName
            },
          },
        },
      },
    },
  })

  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // 2. Формируем payload для JSON
  const payload = {
    sessionId: session.id,
    spaceId: session.spaceId,
    startedAt: session.startedAt?.getTime() ?? null,
    endedAt: session.endedAt?.getTime() ?? null,
    segments: session.transcriptSegments.map((seg) => ({
      id: seg.id,
      speakerId: seg.participantId ?? null,
      speakerName: seg.participant?.user?.displayName ?? seg.participant?.name ?? 'Unknown',
      text: seg.text,
      startedAt: seg.startedAt?.getTime() ?? null,
      endedAt: seg.endedAt?.getTime() ?? null,
      utteranceId: seg.utteranceId ?? null,
    })),
  }

  const body = JSON.stringify(payload, null, 2)
  const blobPath = `transcripts/${session.id}.json`

  // 3. Сохраняем в Vercel Blob
  const { url, size } = await put(blobPath, body, {
    access: 'private', // Приватный доступ (требует авторизации для чтения)
    contentType: 'application/json',
  })

  // 4. Обновляем метаданные сессии
  await db.videoSession.update({
    where: { id: session.id },
    data: {
      rawTranscriptBlobUrl: url,
      rawTranscriptSizeBytes: size,
      rawTranscriptReadyAt: new Date(),
    },
  })

  return {
    blobUrl: url,
    sizeBytes: size,
    segmentsCount: session.transcriptSegments.length,
  }
}


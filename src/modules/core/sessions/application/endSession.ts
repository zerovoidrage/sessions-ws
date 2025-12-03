import { getSessionById, updateSessionStatus } from '../infra/prisma/sessions.repository'
import { scheduleSessionForAnalysis } from './scheduleSessionForAnalysis'
import { finalizeSessionTranscript } from './finalizeSessionTranscript'
import { stopServerTranscription } from './stopServerTranscription'

/**
 * Use-case: завершение сессии.
 * Переводит сессию из LIVE в ENDED, устанавливает endedAt,
 * останавливает серверную транскрипцию,
 * сохраняет сырой транскрипт в Vercel Blob,
 * и запускает подготовку для AI-анализа.
 */
export async function endSession(sessionId: string): Promise<void> {
  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Переводим только LIVE сессии в ENDED
  if (session.status === 'LIVE') {
    const now = new Date()
    await updateSessionStatus(sessionId, 'ENDED', {
      endedAt: now,
    })

    // Останавливаем серверную транскрипцию
    try {
      await stopServerTranscription({ sessionId })
    } catch (error) {
      console.error(`[endSession] Failed to stop server transcription for session ${sessionId}:`, error)
      // Не прерываем процесс - транскрипция может быть уже остановлена
    }

    // Сохраняем сырой транскрипт в Vercel Blob
    try {
      await finalizeSessionTranscript(sessionId)
    } catch (error) {
      // Логируем ошибку, но не прерываем процесс завершения сессии
      console.error(`[endSession] Failed to finalize transcript for session ${sessionId}:`, error)
      // Можно добавить retry логику или очередь для повторной попытки
    }

    // Запускаем подготовку для AI-анализа
    await scheduleSessionForAnalysis(sessionId)
  }
  // Если сессия уже ENDED, EXPIRED или CREATED - ничего не делаем
}



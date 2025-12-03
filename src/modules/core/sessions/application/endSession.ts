import { getSessionById, endSessionByAdmin } from '../infra/prisma/sessions.repository'
import { scheduleSessionForAnalysis } from './scheduleSessionForAnalysis'
import { finalizeSessionTranscript } from './finalizeSessionTranscript'
import { stopServerTranscription } from './stopServerTranscription'

/**
 * Use-case: завершение сессии администратором.
 * Переводит сессию из LIVE в ENDED, устанавливает endReason = ADMIN_ENDED,
 * записывает endedByUserId, рассчитывает durationSeconds,
 * останавливает серверную транскрипцию,
 * сохраняет сырой транскрипт в Vercel Blob,
 * и запускает подготовку для AI-анализа.
 */
export async function endSession(sessionId: string, endedByUserId: string): Promise<void> {
  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Идемпотентность: если сессия уже ENDED или EXPIRED, ничего не делаем
  if (session.status === 'ENDED' || session.status === 'EXPIRED') {
    return
  }

  // Переводим только LIVE сессии в ENDED
  if (session.status === 'LIVE') {
    // Используем новый метод репозитория для завершения
    await endSessionByAdmin({
      sessionId,
      endedByUserId,
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
  // Если сессия в статусе CREATED - ничего не делаем (нельзя завершить неактивированную сессию)
}



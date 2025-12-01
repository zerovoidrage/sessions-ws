import { getSessionById, updateSessionStatus } from '../infra/prisma/sessions.repository'
import { scheduleSessionForAnalysis } from './scheduleSessionForAnalysis'

/**
 * Use-case: завершение сессии.
 * Переводит сессию из LIVE в ENDED, устанавливает endedAt,
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

    // Запускаем подготовку для AI-анализа
    await scheduleSessionForAnalysis(sessionId)
  }
  // Если сессия уже ENDED, EXPIRED или CREATED - ничего не делаем
}



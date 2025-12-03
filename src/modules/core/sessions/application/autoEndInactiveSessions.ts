import { findInactiveLiveSessions, updateSessionStatus } from '../infra/prisma/sessions.repository'
import { scheduleSessionForAnalysis } from './scheduleSessionForAnalysis'

/**
 * Константа: время неактивности в минутах, после которого сессия считается неактивной.
 * 
 * Увеличено до 30 минут, чтобы пользователи не вылетали из сессий,
 * если они просто слушают/смотрят без активности.
 */
const INACTIVE_MINUTES = 30

/**
 * Use-case: автоматическое завершение неактивных LIVE сессий.
 * Находит все LIVE сессии, которые неактивны более N минут,
 * и переводит их в статус ENDED.
 * 
 * Также создаёт записи SessionAnalysis для завершённых сессий.
 * 
 * Этот use-case предназначен для вызова из cron job или фонового воркера.
 */
export async function autoEndInactiveSessions(): Promise<number> {
  const inactiveSessions = await findInactiveLiveSessions(INACTIVE_MINUTES)
  
  let endedCount = 0
  const now = new Date()

  for (const session of inactiveSessions) {
    try {
      // Переводим в ENDED
      await updateSessionStatus(session.id, 'ENDED', {
        endedAt: now,
      })

      // Запускаем подготовку для AI-анализа
      await scheduleSessionForAnalysis(session.id)
      
      endedCount++
    } catch (error) {
      console.error(`[autoEndInactiveSessions] Failed to end session ${session.id}:`, error)
      // Продолжаем обработку остальных сессий
    }
  }

  return endedCount
}


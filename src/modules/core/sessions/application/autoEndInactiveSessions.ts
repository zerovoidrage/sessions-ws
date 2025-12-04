// Auto-end inactive sessions application logic
import { findInactiveLiveSessions, autoEndSession } from '../infra/prisma/sessions.repository'
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
 * и переводит их в статус ENDED с endReason = AUTO_EMPTY_ROOM.
 * 
 * Также создаёт записи SessionAnalysis для завершённых сессий.
 * 
 * Этот use-case предназначен для вызова из cron job или фонового воркера.
 */
export async function autoEndInactiveSessions(): Promise<number> {
  const inactiveSessions = await findInactiveLiveSessions(INACTIVE_MINUTES)
  
  let endedCount = 0

  for (const session of inactiveSessions) {
    try {
      // Проверяем, что сессия все еще LIVE (идемпотентность)
      if (session.status !== 'LIVE') {
        continue
      }

      // Используем новый метод репозитория для автоматического завершения
      await autoEndSession({
        sessionId: session.id,
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


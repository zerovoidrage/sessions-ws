import { findOldCreatedSessions, updateSessionStatus } from '../infra/prisma/sessions.repository'

/**
 * Константа: время в часах, после которого CREATED сессия считается протухшей.
 */
const EXPIRE_HOURS = 24

/**
 * Use-case: перевод протухших CREATED сессий в статус EXPIRED.
 * Находит все CREATED сессии, которые были созданы более X часов назад,
 * и переводит их в статус EXPIRED.
 * 
 * Этот use-case предназначен для вызова из cron job или фонового воркера.
 */
export async function expireOldCreatedSessions(): Promise<number> {
  const oldSessions = await findOldCreatedSessions(EXPIRE_HOURS)
  
  let expiredCount = 0

  for (const session of oldSessions) {
    try {
      await updateSessionStatus(session.id, 'EXPIRED', {})
      expiredCount++
    } catch (error) {
      console.error(`[expireOldCreatedSessions] Failed to expire session ${session.id}:`, error)
      // Продолжаем обработку остальных сессий
    }
  }

  return expiredCount
}



import { getSessionById } from '../infra/prisma/sessions.repository'
import { getSessionAnalysisBySessionId, upsertSessionAnalysis } from '../infra/prisma/session-analysis.repository'

/**
 * Use-case: подготовка сессии для AI-анализа.
 * Создаёт или обновляет запись SessionAnalysis ТОЛЬКО для сессий со статусом ENDED.
 * 
 * Для EXPIRED сессий анализ НЕ создается.
 * 
 * Если статус уже DONE или RUNNING - игнорируем.
 * 
 * Это точка входа для будущего AI-пайплайна.
 */
export async function scheduleSessionForAnalysis(sessionId: string): Promise<void> {
  // Проверяем статус сессии - анализ создается только для ENDED
  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Для EXPIRED сессий не создаем анализ
  if (session.status === 'EXPIRED') {
    return
  }

  // Для CREATED и LIVE сессий тоже не создаем анализ (должны быть ENDED)
  if (session.status !== 'ENDED') {
    console.warn(`[scheduleSessionForAnalysis] Session ${sessionId} is not ENDED (status: ${session.status}), skipping analysis creation`)
    return
  }

  const analysis = await getSessionAnalysisBySessionId(sessionId)
  
  if (!analysis) {
    // Создаём новую запись с PENDING
    await upsertSessionAnalysis({
      sessionId,
      status: 'PENDING',
    })
    return
  }

  // Если уже PENDING или FAILED - оставляем как есть (можно перезапустить позже)
  if (analysis.status === 'PENDING' || analysis.status === 'FAILED') {
    // Ничего не меняем, запись уже готова для обработки
    return
  }

  // Если DONE или RUNNING - игнорируем (уже обработано или обрабатывается)
  if (analysis.status === 'DONE' || analysis.status === 'RUNNING') {
    // Можно залогировать, но не меняем статус
    return
  }
}



import { getSessionAnalysisBySessionId, upsertSessionAnalysis } from '../infra/prisma/session-analysis.repository'

/**
 * Use-case: подготовка сессии для AI-анализа.
 * Создаёт или обновляет запись SessionAnalysis, если она в статусе PENDING или FAILED.
 * Если статус уже DONE или RUNNING - игнорируем.
 * 
 * Это точка входа для будущего AI-пайплайна.
 */
export async function scheduleSessionForAnalysis(sessionId: string): Promise<void> {
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



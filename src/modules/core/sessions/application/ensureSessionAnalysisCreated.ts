import { getSessionAnalysisBySessionId, upsertSessionAnalysis } from '../infra/prisma/session-analysis.repository'

/**
 * Use-case: обеспечить наличие записи SessionAnalysis для сессии.
 * Если запись уже существует, ничего не меняем.
 * Если нет - создаём с статусом PENDING.
 */
export async function ensureSessionAnalysisCreated(sessionId: string): Promise<void> {
  const existing = await getSessionAnalysisBySessionId(sessionId)
  
  if (!existing) {
    await upsertSessionAnalysis({
      sessionId,
      status: 'PENDING',
    })
  }
  // Если уже существует - ничего не делаем
}



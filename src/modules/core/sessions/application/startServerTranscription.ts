/**
 * Use-case: запуск серверной транскрипции для сессии.
 * 
 * Вызывается когда сессия переходит в статус LIVE (первый участник присоединился).
 * Запускает серверный транскрайбер, который подключается к LiveKit комнате
 * и транскрибирует аудио всех участников.
 */

import { getSessionById } from '../infra/prisma/sessions.repository'

export interface StartServerTranscriptionInput {
  sessionId: string
}

/**
 * Запускает серверную транскрипцию для сессии.
 * 
 * ВАЖНО: Эта функция должна вызываться из серверного окружения (API route или background job),
 * так как она использует Node.js модули для работы с LiveKit Server SDK.
 * 
 * Для вызова из Next.js API route используйте динамический импорт:
 * ```typescript
 * const { startServerTranscription } = await import('@/modules/core/sessions/application/startServerTranscription')
 * ```
 */
export async function startServerTranscription(
  input: StartServerTranscriptionInput
): Promise<void> {
  const session = await getSessionById(input.sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Проверяем, что сессия в статусе LIVE
  if (session.status !== 'LIVE') {
    console.warn(`[startServerTranscription] Session ${input.sessionId} is not LIVE (status: ${session.status}), skipping`)
    return
  }

  // Вызываем WebSocket сервер через HTTP API
  // Это проще, чем пытаться загрузить TypeScript модули через require
  try {
    const wsServerUrl = process.env.WS_SERVER_URL || 'http://localhost:3001'
    const response = await fetch(`${wsServerUrl}/api/transcription/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        sessionSlug: session.slug,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    console.log(`[startServerTranscription] Server transcription started for session ${session.id}`)
  } catch (error) {
    console.error(`[startServerTranscription] Failed to start server transcription:`, error)
    // Не бросаем ошибку - транскрипция не критична для работы сессии
    // Можно добавить retry логику или очередь для повторной попытки
  }
}


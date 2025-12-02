/**
 * Use-case: остановка серверной транскрипции для сессии.
 * 
 * Вызывается при завершении сессии (переход в статус ENDED).
 * Останавливает серверный транскрайбер и освобождает ресурсы.
 */

export interface StopServerTranscriptionInput {
  sessionId: string
}

/**
 * Останавливает серверную транскрипцию для сессии.
 * 
 * ВАЖНО: Эта функция должна вызываться из серверного окружения.
 * Для вызова из Next.js API route используйте динамический импорт.
 */
export async function stopServerTranscription(
  input: StopServerTranscriptionInput
): Promise<void> {
  try {
    // Вызываем WebSocket сервер через HTTP API
    const wsServerUrl = process.env.WS_SERVER_URL || 'http://localhost:3001'
    const response = await fetch(`${wsServerUrl}/api/transcription/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: input.sessionId,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    console.log(`[stopServerTranscription] Server transcription stopped for session ${input.sessionId}`)
  } catch (error) {
    console.error(`[stopServerTranscription] Failed to stop server transcription:`, error)
    // Не бросаем ошибку - транскрипция уже может быть остановлена
  }
}


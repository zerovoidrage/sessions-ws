import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { selectNewTranscriptionHost } from '../application/selectNewTranscriptionHost'
import type { SelectNewTranscriptionHostInput, SelectNewTranscriptionHostResult } from '../application/selectNewTranscriptionHost'

/**
 * API endpoint для выбора нового transcription host.
 * Вызывается когда текущий host уходит из сессии.
 */
export async function selectNewTranscriptionHostEndpoint(
  input: SelectNewTranscriptionHostInput
): Promise<SelectNewTranscriptionHostResult> {
  // Проверяем авторизацию (но не требуем, чтобы вызывающий был создателем сессии)
  // Любой участник может запросить выбор нового host
  await getCurrentUser()

  return selectNewTranscriptionHost(input)
}


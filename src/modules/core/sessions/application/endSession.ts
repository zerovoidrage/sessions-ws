import { endSession as endSessionRepo } from '../infra/prisma/sessions.repository'

export async function endSession(sessionId: string): Promise<void> {
  await endSessionRepo(sessionId)
}



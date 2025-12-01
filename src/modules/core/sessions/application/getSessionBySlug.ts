import { getSessionBySlug as getSessionBySlugRepo } from '../infra/prisma/sessions.repository'
import type { GetSessionBySlugInput } from '../domain/session.types'

export async function getSessionBySlug(input: GetSessionBySlugInput) {
  return getSessionBySlugRepo(input)
}




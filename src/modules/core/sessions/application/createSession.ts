import { nanoid } from 'nanoid'
import { createSession as createSessionRepo } from '../infra/prisma/sessions.repository'
import type { CreateSessionInput } from '../domain/session.types'

export async function createSession(input: CreateSessionInput) {
  const slug = nanoid(8)
  
  const session = await createSessionRepo({
    ...input,
    slug,
  })

  return session
}



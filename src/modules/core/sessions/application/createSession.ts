import { nanoid } from 'nanoid'
import { createSession as createSessionRepo } from '../infra/prisma/sessions.repository'
import type { CreateSessionInput } from '../domain/session.types'

/**
 * Use-case: создание новой сессии.
 * Устанавливает статус CREATED, все временные метки в null.
 */
export async function createSession(input: CreateSessionInput) {
  const slug = nanoid(8)
  
  const session = await createSessionRepo({
    ...input,
    slug,
  })

  // Репозиторий уже устанавливает статус CREATED и null для временных полей
  // Но явно проверяем для ясности
  if (session.status !== 'CREATED') {
    throw new Error('Session must be created with CREATED status')
  }

  return session
}



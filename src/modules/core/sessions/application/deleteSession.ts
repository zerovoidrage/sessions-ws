import { getSessionById } from '../infra/prisma/sessions.repository'
import { deleteSessionById } from '../infra/prisma/sessions.repository'
import { getUserRoleInSpace } from '../../spaces/infra/spaces.repository'

export interface DeleteSessionInput {
  userId: string
  sessionId: string
}

/**
 * Удаляет сессию
 * Проверяет, что пользователь имеет доступ к Space, к которому принадлежит сессия
 * Только владелец Space или создатель сессии может удалять
 */
export async function deleteSession(input: DeleteSessionInput): Promise<void> {
  const session = await getSessionById(input.sessionId)
  if (!session) {
    throw new Error('NOT_FOUND: Session not found')
  }

  // Проверяем доступ к Space
  const role = await getUserRoleInSpace(input.userId, session.spaceId)
  if (!role) {
    throw new Error('FORBIDDEN: User does not have access to this space')
  }

  // Проверяем, что пользователь - владелец Space или создатель сессии
  const isOwner = role === 'OWNER'
  const isCreator = session.createdByUserId === input.userId

  if (!isOwner && !isCreator) {
    throw new Error('FORBIDDEN: Only space owner or session creator can delete')
  }

  await deleteSessionById(input.sessionId)
}





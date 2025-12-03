import { listSessionsBySpace as listSessionsBySpaceRepo } from '../infra/prisma/sessions.repository'
import type { ListSessionsBySpaceInput } from '../domain/session.types'

export async function listSessionsBySpace(input: ListSessionsBySpaceInput) {
  // TODO: Проверить, что пользователь имеет доступ к space
  return listSessionsBySpaceRepo(input.spaceId)
}





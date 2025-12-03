import { db } from '@/lib/db'
import type { Space, CreateSpaceInput, UpdateSpaceModeInput } from '../domain/space.types'

export async function listByUser(userId: string): Promise<Space[]> {
  const spaces = await db.space.findMany({
    where: {
      members: {
        some: {
          userId,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    ownerId: s.ownerId,
    mode: s.mode as Space['mode'],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }))
}

export async function createForUser(userId: string, input: CreateSpaceInput): Promise<Space> {
  const space = await db.space.create({
    data: {
      name: input.name,
      ownerId: userId,
      mode: input.mode,
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
    },
  })

  return {
    id: space.id,
    name: space.name,
    ownerId: space.ownerId,
    mode: space.mode as Space['mode'],
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  }
}

export async function rename(spaceId: string, name: string): Promise<Space> {
  const space = await db.space.update({
    where: { id: spaceId },
    data: { name },
  })

  return {
    id: space.id,
    name: space.name,
    ownerId: space.ownerId,
    mode: space.mode as Space['mode'],
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  }
}

export async function deleteSpace(spaceId: string): Promise<void> {
  // Удаляем все связанные записи перед удалением Space
  await db.$transaction(async (tx) => {
    // Удаляем всех участников пространства
    await tx.spaceMember.deleteMany({
      where: { spaceId },
    })
    
    // Удаляем все сессии пространства (если они есть)
    // Примечание: VideoSession может иметь каскадное удаление, но лучше явно удалить
    await tx.videoSession.deleteMany({
      where: { spaceId },
    })
    
    // Обновляем activeSpaceId у пользователей, если они указывали на это пространство
    await tx.user.updateMany({
      where: { activeSpaceId: spaceId },
      data: { activeSpaceId: null },
    })
    
    // Теперь можно безопасно удалить Space
    await tx.space.delete({
      where: { id: spaceId },
    })
  })
}

export async function updateMode(spaceId: string, input: UpdateSpaceModeInput): Promise<Space> {
  const space = await db.space.update({
    where: { id: spaceId },
    data: { mode: input.mode },
  })

  return {
    id: space.id,
    name: space.name,
    ownerId: space.ownerId,
    mode: space.mode as Space['mode'],
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  }
}

export async function getById(spaceId: string): Promise<Space | null> {
  const space = await db.space.findUnique({
    where: { id: spaceId },
  })

  if (!space) return null

  return {
    id: space.id,
    name: space.name,
    ownerId: space.ownerId,
    mode: space.mode as Space['mode'],
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  }
}

export async function getUserRoleInSpace(userId: string, spaceId: string): Promise<'OWNER' | 'MEMBER' | null> {
  const member = await db.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId,
        userId,
      },
    },
  })

  return member?.role as 'OWNER' | 'MEMBER' | null
}


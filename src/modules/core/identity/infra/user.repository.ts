import { db } from '@/lib/db'
import type { DomainUser, UpdateProfileInput } from '../domain/user.types'

/**
 * Генерирует детерминированный пастельный цвет по email
 * Использует HSL с фиксированными Saturation и Lightness
 */
export function generateNoAvatarColor(email: string): string {
  // Детерминированный hash по email
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  // H = hash % 360 (оттенок), S = 70%, L = 60% (пастельный)
  const hue = Math.abs(hash) % 360
  const saturation = 70
  const lightness = 60
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

export async function findById(id: string): Promise<DomainUser | null> {
  const user = await db.user.findUnique({
    where: { id },
  })

  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    noAvatarColor: user.noAvatarColor,
    activeSpaceId: user.activeSpaceId,
  }
}

export async function findByEmail(email: string): Promise<DomainUser | null> {
  const user = await db.user.findUnique({
    where: { email },
  })

  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    noAvatarColor: user.noAvatarColor,
    activeSpaceId: user.activeSpaceId,
  }
}

/**
 * Создает или обновляет пользователя из OAuth профиля
 * ВАЖНО: ИГНОРИРУЕТ image/picture из Google - аватар только через Cloudinary или noAvatarColor
 */
export async function createOrUpdateFromOAuth(params: {
  email: string
  name?: string | null
  image?: string | null // Игнорируется - не используем Google фото
}): Promise<DomainUser> {
  const existing = await db.user.findUnique({
    where: { email: params.email },
  })

  const noAvatarColor = existing?.noAvatarColor || generateNoAvatarColor(params.email)

  const user = await db.user.upsert({
    where: { email: params.email },
    create: {
      email: params.email,
      name: params.name,
      displayName: null, // Пользователь должен установить на онбординге
      avatarUrl: null, // НЕ используем Google image
      noAvatarColor,
    },
    update: {
      name: params.name,
      // НЕ обновляем avatarUrl из Google image
      // НЕ обновляем displayName если он уже установлен
      // Обновляем noAvatarColor только если его еще нет
      noAvatarColor: existing?.noAvatarColor || noAvatarColor,
    },
  })

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    noAvatarColor: user.noAvatarColor,
    activeSpaceId: user.activeSpaceId,
  }
}

/**
 * Обновляет профиль пользователя
 * Если avatarUrl не передан - не трогаем
 * Если передан null - сбрасываем аватар (останется noAvatarColor)
 * Если передан URL - сохраняем
 */
export async function updateUserProfile(input: {
  userId: string
  displayName?: string
  avatarUrl?: string | null
}): Promise<DomainUser> {
  const updateData: {
    displayName?: string
    avatarUrl?: string | null
  } = {}

  if (input.displayName !== undefined) {
    updateData.displayName = input.displayName
  }

  if (input.avatarUrl !== undefined) {
    updateData.avatarUrl = input.avatarUrl
  }

  const user = await db.user.update({
    where: { id: input.userId },
    data: updateData,
  })

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    noAvatarColor: user.noAvatarColor,
    activeSpaceId: user.activeSpaceId,
  }
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<DomainUser> {
  return updateUserProfile({
    userId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
  })
}

export async function setActiveSpace(userId: string, spaceId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { activeSpaceId: spaceId },
  })
}


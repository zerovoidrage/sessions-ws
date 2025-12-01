export type DomainUser = {
  id: string
  email: string
  name?: string | null
  displayName?: string | null
  avatarUrl?: string | null
  noAvatarColor?: string | null
  activeSpaceId?: string | null
}

export interface UpdateProfileInput {
  displayName?: string
  avatarUrl?: string | null // null для сброса аватара
}


export type SpaceMode = 'SESSIONS_ONLY' | 'SESSIONS_AND_TASKS'

export type SpaceRole = 'OWNER' | 'MEMBER'

export interface Space {
  id: string
  name: string
  ownerId: string
  mode: SpaceMode
  createdAt: Date
  updatedAt: Date
}

export interface CreateSpaceInput {
  name: string
  mode: SpaceMode
}

export interface UpdateSpaceModeInput {
  mode: SpaceMode
}





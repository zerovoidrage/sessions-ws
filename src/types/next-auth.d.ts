import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      displayName?: string | null
      avatarUrl?: string | null
      noAvatarColor?: string | null
      activeSpaceId?: string | null
    }
  }

  interface User {
    id: string
    email: string
    name?: string | null
    image?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    id?: string
    displayName?: string | null
    avatarUrl?: string | null
    noAvatarColor?: string | null
    activeSpaceId?: string | null
  }
}


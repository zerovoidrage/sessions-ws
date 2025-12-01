import { getServerSession } from 'next-auth'
import { authOptions } from '../infra/auth.config'
import { findById } from '../infra/user.repository'
import type { DomainUser } from '../domain/user.types'

export async function getCurrentUser(): Promise<DomainUser | null> {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return null
  }

  return findById(session.user.id)
}




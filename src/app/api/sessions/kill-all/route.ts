import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { deleteAllSessions } from '@/modules/core/sessions/infra/prisma/sessions.repository'

// DELETE /api/sessions/kill-all
export async function DELETE() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }

    await deleteAllSessions()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting all sessions:', error)
    return new NextResponse('Failed to delete all sessions', { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getTasksPlaceholderEndpoint } from '@/modules/core/tasks/api/getTasksPlaceholderEndpoint'

// GET /api/tasks
export async function GET() {
  try {
    const user = await getCurrentUser()
    const result = await getTasksPlaceholderEndpoint(user)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message === 'TASKS_DISABLED') {
      return new NextResponse('TASKS_DISABLED', { status: 403 })
    }
    console.error('Error getting tasks:', error)
    return new NextResponse('Failed to get tasks', { status: 500 })
  }
}



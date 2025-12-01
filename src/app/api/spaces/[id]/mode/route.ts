import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { updateSpaceModeEndpoint } from '@/modules/core/spaces/api'

interface Params {
  params: Promise<{ id: string }>
}

// PATCH /api/spaces/[id]/mode
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const { id } = await params
    const body = await req.json()
    const space = await updateSpaceModeEndpoint(user, id, body)
    return NextResponse.json(space)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message.includes('FORBIDDEN')) {
      return new NextResponse('FORBIDDEN', { status: 403 })
    }
    console.error('Error updating space mode:', error)
    return new NextResponse('Failed to update space mode', { status: 500 })
  }
}


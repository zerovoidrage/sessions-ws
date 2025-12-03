import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { renameSpaceEndpoint, deleteSpaceEndpoint } from '@/modules/core/spaces/api'

interface Params {
  params: Promise<{ id: string }>
}

// PATCH /api/spaces/[id]
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const { id } = await params
    const body = await req.json()
    const space = await renameSpaceEndpoint(user, id, body.name)
    return NextResponse.json(space)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message.includes('FORBIDDEN')) {
      return new NextResponse('FORBIDDEN', { status: 403 })
    }
    console.error('Error renaming space:', error)
    return new NextResponse('Failed to rename space', { status: 500 })
  }
}

// DELETE /api/spaces/[id]
export async function DELETE(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const { id } = await params
    await deleteSpaceEndpoint(user, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message === 'LAST_SPACE') {
      return NextResponse.json(
        { error: 'Cannot delete the last space' },
        { status: 400 }
      )
    }
    if (error instanceof Error && error.message.includes('FORBIDDEN')) {
      return new NextResponse('FORBIDDEN', { status: 403 })
    }
    console.error('Error deleting space:', error)
    return new NextResponse('Failed to delete space', { status: 500 })
  }
}


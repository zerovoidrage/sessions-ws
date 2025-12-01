import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { deleteSessionEndpoint } from '@/modules/core/sessions/api/deleteSessionEndpoint'

interface Params {
  params: Promise<{ slug: string }>
}

// DELETE /api/sessions/[slug]
export async function DELETE(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }

    const { slug } = await params
    await deleteSessionEndpoint(user, slug)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message.includes('FORBIDDEN')) {
      return new NextResponse('FORBIDDEN', { status: 403 })
    }
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return new NextResponse('NOT_FOUND', { status: 404 })
    }
    console.error('Error deleting session:', error)
    return new NextResponse('Failed to delete session', { status: 500 })
  }
}



import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { setActiveSpaceEndpoint } from '@/modules/core/spaces/api'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/spaces/[id]/set-active
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const { id } = await params
    await setActiveSpaceEndpoint(user, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message.includes('FORBIDDEN')) {
      return new NextResponse('FORBIDDEN', { status: 403 })
    }
    console.error('Error setting active space:', error)
    return new NextResponse('Failed to set active space', { status: 500 })
  }
}


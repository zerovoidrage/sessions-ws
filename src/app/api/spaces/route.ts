import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { listSpacesEndpoint, createSpaceEndpoint } from '@/modules/core/spaces/api'

// GET /api/spaces
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const spaces = await listSpacesEndpoint(user)
    return NextResponse.json({ spaces })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    console.error('Error listing spaces:', error)
    return new NextResponse('Failed to list spaces', { status: 500 })
  }
}

// POST /api/spaces
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const body = await req.json()
    const space = await createSpaceEndpoint(user, body)
    return NextResponse.json(space)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    console.error('Error creating space:', error)
    return new NextResponse('Failed to create space', { status: 500 })
  }
}


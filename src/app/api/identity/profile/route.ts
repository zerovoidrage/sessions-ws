import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getProfileEndpoint, updateProfileEndpoint } from '@/modules/core/identity/api'

// GET /api/identity/profile
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const profile = await getProfileEndpoint(user.id)
    return NextResponse.json(profile)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    console.error('Error getting profile:', error)
    return new NextResponse('Failed to get profile', { status: 500 })
  }
}

// PATCH /api/identity/profile
export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const body = await req.json()
    const updated = await updateProfileEndpoint(user.id, body)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    if (error instanceof Error && error.message.startsWith('INVALID_INPUT:')) {
      return NextResponse.json(
        { error: error.message.replace('INVALID_INPUT: ', '') },
        { status: 400 }
      )
    }
    console.error('Error updating profile:', error)
    return new NextResponse('Failed to update profile', { status: 500 })
  }
}


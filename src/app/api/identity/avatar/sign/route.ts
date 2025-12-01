import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getAvatarUploadSignatureEndpoint } from '@/modules/core/identity/api'

// GET /api/identity/avatar/sign
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    const signature = await getAvatarUploadSignatureEndpoint(user.id)
    return NextResponse.json(signature)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return new NextResponse('UNAUTHORIZED', { status: 401 })
    }
    console.error('Error getting avatar signature:', error)
    return new NextResponse('Failed to get avatar signature', { status: 500 })
  }
}


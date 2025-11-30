import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { db } from '@/lib/db'

// POST /api/calls
// Создаёт новую комнату для звонка и возвращает slug
// TODO: можно добавить проверку сессии через NextAuth для createdByUserId
export async function POST() {
  try {
    const slug = nanoid(8)

    const room = await db.callRoom.create({
      data: {
        slug,
        // createdByUserId: ... (опционально, если есть сессия)
      },
    })

    return NextResponse.json({ slug: room.slug })
  } catch (error) {
    console.error('Error creating call room:', error)
    return new NextResponse('Failed to create room', { status: 500 })
  }
}




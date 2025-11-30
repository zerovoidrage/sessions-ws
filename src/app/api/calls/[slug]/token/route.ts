import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { livekitEnv } from '@/lib/env/livekit'
import { AccessToken } from 'livekit-server-sdk'

interface Params {
  params: Promise<{ slug: string }>
}

// GET /api/calls/[slug]/token?name=DisplayName
// Выдаёт LiveKit токен для подключения к комнате
// TODO: взять реальный userId из сессии / JWT для identity
export async function GET(req: Request, { params }: Params) {
  try {
    const { slug } = await params

    const room = await db.callRoom.findUnique({
      where: { slug },
    })

    if (!room) {
      return new NextResponse('Room not found', { status: 404 })
    }

    // Получаем имя из query параметров
    const url = new URL(req.url)
    const displayName = url.searchParams.get('name')?.trim() || ''

    // TODO: взять реальный userId из сессии / JWT.
    // Пока можно сгенерировать рандомный identity.
    const randomIdentity = `guest-${slug}-${Math.random().toString(36).slice(2, 8)}`

    if (!livekitEnv.apiKey || !livekitEnv.apiSecret) {
      return new NextResponse('LiveKit env not configured', { status: 500 })
    }

    const at = new AccessToken(livekitEnv.apiKey, livekitEnv.apiSecret, {
      identity: randomIdentity,
      name: displayName || undefined, // Устанавливаем имя участника
    })

    at.addGrant({
      room: room.slug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    })

    const token = await at.toJwt()

    return NextResponse.json({
      token,
      roomName: room.slug,
      identity: randomIdentity,
      serverUrl: livekitEnv.wsUrl,
    })
  } catch (error) {
    console.error('Error generating token:', error)
    return new NextResponse('Failed to generate token', { status: 500 })
  }
}


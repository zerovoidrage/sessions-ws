import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/modules/core/identity/application/getCurrentUser'
import { getSessionBySlug } from '@/modules/core/sessions/application/getSessionBySlug'
import { getParticipantWithUserByIdentity } from '@/modules/core/sessions/infra/participants/participants.repository'

interface Params {
  params: Promise<{ slug: string; identity: string }>
}

// GET /api/sessions/[slug]/participants/[identity]
export async function GET(req: Request, { params }: Params) {
  try {
    // Разрешаем доступ без авторизации для гостей
    const user = await getCurrentUser()

    const { slug, identity: encodedIdentity } = await params

    // Next.js автоматически декодирует параметры в пути, но identity может быть в разных форматах
    // Используем encodedIdentity как есть - Next.js уже декодировал его
    const identity = encodedIdentity

    const session = await getSessionBySlug({ slug })
    if (!session) {
      return new NextResponse('Session not found', { status: 404 })
    }

    const participant = await getParticipantWithUserByIdentity(session.id, identity)

    // Если участник найден в БД - возвращаем его данные
    if (participant) {
      // Для гостей (без user) возвращаем name из БД
      // Для авторизованных пользователей возвращаем user.displayName если есть
      // ВАЖНО: для гостей participant.name должен быть установлен при join
      const finalName = participant.name || (participant.user ? participant.user.displayName : null)
      
      return NextResponse.json({
        ...participant,
        // Убеждаемся, что для гостей возвращается name из БД, а не identity
        name: finalName || identity,
      })
    }

    // Если участник не найден в БД (еще не создан, т.к. не было транскриптов),
    // возвращаем базовую информацию на основе identity
    // Пытаемся извлечь userId из identity (формат: userId:sessionId или userId:sessionId:index)
    const identityParts = identity.split(':')
    const possibleUserId = identityParts[0]
    
    // Если identity начинается с userId (не guest-), пытаемся найти пользователя
    let userData = null
    if (possibleUserId && !identity.startsWith('guest-')) {
      try {
        const { db } = await import('@/lib/db')
        const foundUser = await db.user.findUnique({
          where: { id: possibleUserId },
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            noAvatarColor: true,
          },
        })
        if (foundUser) {
          userData = {
            id: foundUser.id,
            displayName: foundUser.displayName,
            avatarUrl: foundUser.avatarUrl,
            noAvatarColor: foundUser.noAvatarColor,
          }
        }
      } catch (e) {
        // Игнорируем ошибки при поиске пользователя
      }
    }

    // Если identity начинается с "guest-", это гость без userId
    const isGuest = identity.startsWith('guest-')
    
    // Для гостей, если участник еще не зарегистрирован, используем identity как имя
    // Когда участник зарегистрируется через join endpoint, имя будет обновлено в БД
    const fallbackName = identity

    return NextResponse.json({
      id: null,
      sessionId: session.id,
      userId: userData?.id || null,
      identity,
      name: fallbackName,
      role: 'GUEST' as const,
      joinedAt: new Date(),
      leftAt: null,
      user: userData,
    })
  } catch (error) {
    console.error('[GET /api/sessions/[slug]/participants/[identity]] Error:', error)
    return new NextResponse('Failed to get participant', { status: 500 })
  }
}


import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

  // Публичные пути
  const publicPaths = ['/auth', '/api/auth']
  const isPublicPath = publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))

  // Разрешаем доступ к статическим файлам из public (включая /audio/, /images/ и т.д.)
  const isPublicStaticFile = request.nextUrl.pathname.startsWith('/audio/') || 
                             request.nextUrl.pathname.startsWith('/images/') ||
                             request.nextUrl.pathname.match(/^\/[^/]+\.(js|css|json|ico|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|eot)$/)

  // Разрешаем доступ к страницам сессий без авторизации (для гостей)
  const isSessionPath = request.nextUrl.pathname.startsWith('/session/')

  // Разрешаем доступ к API для регистрации гостей в сессиях
  const isGuestJoinApi = request.nextUrl.pathname.match(/^\/api\/sessions\/[^/]+\/participants\/join$/)

  // Разрешаем доступ к API для получения токена для гостей
  const isGuestTokenApi = request.nextUrl.pathname.match(/^\/api\/sessions\/[^/]+\/token$/)

  // Разрешаем доступ к API для получения данных участника (нужно для TranscriptSidebar)
  const isParticipantApi = request.nextUrl.pathname.match(/^\/api\/sessions\/[^/]+\/participants\/.+$/)

  // Разрешаем доступ к API для сохранения метрик транскрипции (для гостей тоже)
  const isTranscriptionUsageApi = request.nextUrl.pathname === '/api/transcription/usage/save'

  if (isPublicPath || isPublicStaticFile || isSessionPath || isGuestJoinApi || isGuestTokenApi || isParticipantApi || isTranscriptionUsageApi) {
    return NextResponse.next()
  }

  // Если не авторизован - редирект на signin
  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url)
    signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }

  // Проверка онбординга для защищенных путей
  const onboardingPaths = ['/onboarding']
  const isOnboardingPath = onboardingPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (!isOnboardingPath) {
    // Для всех остальных путей проверяем онбординг
    // Но делаем это на уровне страницы, а не middleware, чтобы избежать лишних запросов к БД
    // Middleware только проверяет авторизацию
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (js, css, images, fonts, etc.)
     * - files in public folder (audio, images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|audio/|images/|.*\\.(?:js|css|json|ico|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|eot)$).*)',
  ],
}



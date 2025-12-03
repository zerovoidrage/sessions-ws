import { NextResponse } from 'next/server'
import { expireOldCreatedSessions } from '@/modules/core/sessions/application/expireOldCreatedSessions'

/**
 * Cron job endpoint для истечения срока действия неактивированных CREATED сессий.
 * 
 * Вызывается Vercel Cron Jobs по расписанию (раз в час или раз в день).
 * 
 * Защита: проверяет CRON_SECRET из environment variables.
 */
export async function GET(req: Request) {
  // Проверка секрета для безопасности (только Vercel может вызывать)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  
  if (!cronSecret) {
    console.error('[cron/expire-sessions] CRON_SECRET is not set')
    return new NextResponse('CRON_SECRET not configured', { status: 500 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/expire-sessions] Unauthorized cron request', {
      authHeader: authHeader ? 'present' : 'missing',
    })
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const expiredCount = await expireOldCreatedSessions()
    
    console.log('[cron/expire-sessions] ✅ Completed', {
      expiredCount,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      status: 'ok',
      expiredCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/expire-sessions] ❌ Error:', error)
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}


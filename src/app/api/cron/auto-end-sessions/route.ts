import { NextResponse } from 'next/server'
import { autoEndInactiveSessions } from '@/modules/core/sessions/application/autoEndInactiveSessions'

/**
 * Cron job endpoint для автоматического завершения неактивных LIVE сессий.
 * 
 * Вызывается Vercel Cron Jobs по расписанию (каждые 5-10 минут).
 * 
 * Защита: проверяет CRON_SECRET из environment variables.
 */
export async function GET(req: Request) {
  // Проверка секрета для безопасности (только Vercel может вызывать)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  
  if (!cronSecret) {
    console.error('[cron/auto-end-sessions] CRON_SECRET is not set')
    return new NextResponse('CRON_SECRET not configured', { status: 500 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/auto-end-sessions] Unauthorized cron request', {
      authHeader: authHeader ? 'present' : 'missing',
    })
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const endedCount = await autoEndInactiveSessions()
    
    console.log('[cron/auto-end-sessions] ✅ Completed', {
      endedCount,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      status: 'ok',
      endedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/auto-end-sessions] ❌ Error:', error)
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}


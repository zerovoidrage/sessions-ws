'use client'

import dynamic from 'next/dynamic'
import type { AiSessionInsights } from '@/modules/core/intelligence/domain/intelligence.types'

interface SessionPageClientWrapperProps {
  sessionSlug: string
  initialAiInsights: AiSessionInsights | null
}

// Динамический импорт с отключением SSR для SessionPageClient
// Это гарантирует, что useSession будет работать только на клиенте
// Остальные части страницы (SessionMetaPanel) рендерятся на сервере
const SessionPageClient = dynamic(() => import('./SessionPageClient').then(mod => ({ default: mod.SessionPageClient })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen">
      <p className="text-white-700">Loading session...</p>
    </div>
  ),
})

export function SessionPageClientWrapper({ sessionSlug, initialAiInsights }: SessionPageClientWrapperProps) {
  return <SessionPageClient sessionSlug={sessionSlug} initialAiInsights={initialAiInsights} />
}


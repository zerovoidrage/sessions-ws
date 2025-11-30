// src/lib/env/livekit.ts
export const livekitEnv = {
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  wsUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL!,
}

if (!livekitEnv.apiKey || !livekitEnv.apiSecret || !livekitEnv.wsUrl) {
  // Можно просто warning в console, не кидай ошибку на уровне импорта
  console.warn('[LiveKit] Missing LIVEKIT env vars')
}




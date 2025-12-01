import { livekitEnv } from '@/lib/env/livekit'

export const livekitClientConfig = {
  serverUrl: livekitEnv.wsUrl,
  getToken: async (sessionSlug: string, identity: string, name?: string) => {
    const response = await fetch(`/api/sessions/${sessionSlug}/token?name=${encodeURIComponent(name || '')}`)
    if (!response.ok) {
      throw new Error('Failed to get token')
    }
    const data = await response.json()
    return data.token
  },
}




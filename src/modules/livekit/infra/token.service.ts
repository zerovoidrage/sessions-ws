import { AccessToken } from 'livekit-server-sdk'
import { livekitEnv } from '@/lib/env/livekit'

export interface GenerateTokenInput {
  sessionSlug: string
  identity: string
  name?: string
}

export interface TokenResult {
  token: string
  roomName: string
  identity: string
  serverUrl: string
}

export async function generateToken(input: GenerateTokenInput): Promise<TokenResult> {
  if (!livekitEnv.apiKey || !livekitEnv.apiSecret) {
    throw new Error('LiveKit env not configured')
  }

  const at = new AccessToken(livekitEnv.apiKey, livekitEnv.apiSecret, {
    identity: input.identity,
    name: input.name,
  })

  at.addGrant({
    room: input.sessionSlug,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  const token = await at.toJwt()

  return {
    token,
    roomName: input.sessionSlug,
    identity: input.identity,
    serverUrl: livekitEnv.wsUrl,
  }
}



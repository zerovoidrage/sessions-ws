import { AccessToken } from 'livekit-server-sdk'
import jwt from 'jsonwebtoken'
import { livekitEnv } from '@/lib/env/livekit'
import { getSessionBySlug } from '../../application/getSessionBySlug'

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

export interface GenerateTranscriptionTokenInput {
  sessionSlug: string
  userId?: string
  identity: string
}

export interface TranscriptionTokenResult {
  transcriptionToken: string
  expiresIn: number
}

/**
 * Генерирует JWT токен для авторизации WebSocket соединения для транскрипции.
 * 
 * Токен содержит:
 * - sub: userId или identity
 * - sessionId: ID сессии из БД
 * - sessionSlug: slug сессии
 * - identity: LiveKit identity
 * - exp: время истечения (1 час)
 * 
 * Используется для защиты WebSocket соединения - только пользователи с валидным
 * токеном могут подключаться к транскрипции для конкретной сессии.
 */
export async function generateTranscriptionToken(
  input: GenerateTranscriptionTokenInput
): Promise<TranscriptionTokenResult> {
  // Проверяем, что сессия существует
  const session = await getSessionBySlug({ slug: input.sessionSlug })
  if (!session) {
    throw new Error(`Session not found: ${input.sessionSlug}`)
  }

  // TODO: Проверка доступа к сессии через spaceId (если нужно)

  const jwtSecret = process.env.TRANSCRIPTION_JWT_SECRET
  if (!jwtSecret) {
    throw new Error('TRANSCRIPTION_JWT_SECRET environment variable is not set')
  }

  const expiresIn = 3600 // 1 час
  const payload = {
    sub: input.userId || input.identity,
    sessionId: session.id,
    sessionSlug: session.slug,
    identity: input.identity,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    iat: Math.floor(Date.now() / 1000), // issued at
  }

  const transcriptionToken = jwt.sign(payload, jwtSecret, {
    algorithm: 'HS256',
  })

  return {
    transcriptionToken,
    expiresIn,
  }
}



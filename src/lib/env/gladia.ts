// src/lib/env/gladia.ts
'use server'

export function getGladiaApiKey(): string {
  const key = process.env.GLADIA_API_KEY
  if (!key) {
    throw new Error('GLADIA_API_KEY is not set')
  }
  return key
}


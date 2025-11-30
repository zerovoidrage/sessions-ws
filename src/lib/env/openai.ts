// src/lib/env/openai.ts
export const openaiEnv = {
  apiKey: process.env.OPENAI_API_KEY!,
}

if (!openaiEnv.apiKey) {
  console.warn('[OpenAI] Missing OPENAI_API_KEY env var')
}




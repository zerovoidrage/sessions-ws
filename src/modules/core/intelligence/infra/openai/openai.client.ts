/**
 * OpenAI client for Intelligence module.
 * 
 * Provides a simple interface for making OpenAI API calls.
 */

import { openaiEnv } from '@/lib/env/openai'

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAICompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: { type: 'json_object' }
}

export interface OpenAICompletionResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Makes a completion request to OpenAI API.
 */
export async function openaiCompletion(
  messages: OpenAIMessage[],
  options: OpenAICompletionOptions = {}
): Promise<OpenAICompletionResponse> {
  const apiKey = openaiEnv.apiKey
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const model = options.model || 'gpt-4o-mini'
  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? 2000

  const requestBody: any = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  }

  if (options.responseFormat) {
    requestBody.response_format = options.responseFormat
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 500)}`)
  }

  const data = await response.json()

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No content in OpenAI response')
  }

  return {
    content,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  }
}



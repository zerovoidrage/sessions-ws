/**
 * Unified error handling for API routes.
 * Maps domain errors to appropriate HTTP status codes.
 */

import { NextResponse } from 'next/server'

export interface ApiError {
  message: string
  status: number
}

/**
 * Maps domain error messages to HTTP status codes.
 */
export function mapErrorToStatus(error: Error | string): ApiError {
  const message = error instanceof Error ? error.message : error

  // Authentication errors
  if (message.includes('UNAUTHORIZED') || message.includes('Unauthorized')) {
    return { message: 'Unauthorized', status: 401 }
  }

  // Authorization errors
  if (message.includes('FORBIDDEN') || message.includes('Forbidden') || message.includes('Access denied')) {
    return { message: 'Forbidden', status: 403 }
  }

  // Not found errors
  if (message.includes('NOT_FOUND') || message.includes('not found') || message.includes('Session not found')) {
    return { message: 'Not Found', status: 404 }
  }

  // Validation errors
  if (message.includes('INVALID_INPUT') || message.includes('Invalid') || message.includes('Missing')) {
    return { message: 'Bad Request', status: 400 }
  }

  // Default to 500 for unknown errors
  return { message: 'Internal Server Error', status: 500 }
}

/**
 * Handles errors in API routes and returns appropriate NextResponse.
 */
export function handleApiError(error: unknown): NextResponse {
  const apiError = mapErrorToStatus(error instanceof Error ? error : new Error(String(error)))
  
  console.error('[API Error]', {
    message: apiError.message,
    status: apiError.status,
    originalError: error instanceof Error ? error.message : String(error),
  })

  return NextResponse.json(
    { error: apiError.message },
    { status: apiError.status }
  )
}


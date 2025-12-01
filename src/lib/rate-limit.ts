// src/lib/rate-limit.ts
// Простая in-memory система rate limiting для API endpoints

/**
 * Конфигурация rate limit.
 */
interface RateLimitConfig {
  /** Максимальное количество запросов */
  maxRequests: number
  /** Окно времени в миллисекундах */
  windowMs: number
}

/**
 * Хранилище rate limit данных (in-memory).
 * В production лучше использовать Redis для распределенных систем.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Очищает хранилище rate limit (для тестов).
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear()
}

/**
 * Очищает устаревшие записи из хранилища (вызывается периодически).
 */
function cleanupStore() {
  const now = Date.now()
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}

// Запускаем очистку каждые 5 минут
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupStore, 5 * 60 * 1000)
}

/**
 * Проверяет rate limit для ключа (например, IP адрес или userId).
 * 
 * @param key Уникальный ключ для rate limiting (IP, userId и т.д.)
 * @param config Конфигурация rate limit
 * @returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(key: string, config: RateLimitConfig): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  // Если записи нет или окно истекло - создаем новую
  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs
    rateLimitStore.set(key, {
      count: 1,
      resetAt,
    })
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt,
    }
  }

  // Если лимит превышен
  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  // Увеличиваем счетчик
  entry.count++
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  }
}

/**
 * Получает IP адрес из запроса (поддержка прокси).
 */
export function getClientIP(req: Request): string {
  // Пробуем получить IP из заголовков (для прокси)
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  const realIP = req.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback (для dev окружения)
  return 'unknown'
}

/**
 * Middleware для rate limiting в API routes.
 * 
 * @param config Конфигурация rate limit
 * @returns Middleware функция
 */
export function withRateLimit(config: RateLimitConfig) {
  return async (req: Request): Promise<Response | null> => {
    // Получаем ключ для rate limiting (IP адрес или userId)
    const ip = getClientIP(req)
    const result = checkRateLimit(ip, config)

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message: `Rate limit exceeded. Please try again after ${new Date(result.resetAt).toISOString()}`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': result.resetAt.toString(),
            'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
          },
        }
      )
    }

    // Добавляем заголовки rate limit в ответ
    // (нужно будет вернуть их через headers в NextResponse)
    return null // Продолжаем обработку
  }
}

/**
 * Предустановленные конфигурации rate limit для разных типов endpoints.
 */
export const RATE_LIMIT_CONFIGS = {
  /** Общие API endpoints (GET запросы, списки) */
  default: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 минута
  },
  /** Создание ресурсов (POST запросы) */
  create: {
    maxRequests: 20,
    windowMs: 60 * 1000, // 1 минута
  },
  /** Обновление ресурсов (PATCH/PUT) */
  update: {
    maxRequests: 30,
    windowMs: 60 * 1000, // 1 минута
  },
  /** Удаление ресурсов (DELETE) */
  delete: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 минута
  },
  /** Аутентификация и токены */
  auth: {
    maxRequests: process.env.NODE_ENV === 'development' ? 60 : 30, // Dev: 60/мин, Prod: 30/мин
    windowMs: 60 * 1000, // 1 минута
  },
  /** Загрузка файлов */
  upload: {
    maxRequests: 5,
    windowMs: 60 * 1000, // 1 минута
  },
} as const


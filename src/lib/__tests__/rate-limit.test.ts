// src/lib/__tests__/rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit, getClientIP, RATE_LIMIT_CONFIGS, clearRateLimitStore } from '../rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    // Очищаем состояние перед каждым тестом
    // Примечание: в реальном коде rateLimitStore - это Map, которая сохраняется между тестами
    // В production это нормально, но для тестов нужно очищать вручную
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearRateLimitStore() // Очищаем хранилище между тестами
  })

  describe('checkRateLimit', () => {
    it('should allow requests within limit', () => {
      const config = { maxRequests: 5, windowMs: 60000 }
      const key = 'test-ip'

      // Первые 5 запросов должны быть разрешены
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(key, config)
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(5 - i - 1)
      }
    })

    it('should reject requests exceeding limit', () => {
      const config = { maxRequests: 3, windowMs: 60000 }
      const key = 'test-ip'

      // Делаем 3 запроса
      checkRateLimit(key, config)
      checkRateLimit(key, config)
      checkRateLimit(key, config)

      // 4-й запрос должен быть отклонен
      const result = checkRateLimit(key, config)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should reset limit after window expires', () => {
      const config = { maxRequests: 2, windowMs: 1000 }
      const key = 'test-ip'

      // Исчерпываем лимит
      checkRateLimit(key, config)
      checkRateLimit(key, config)
      
      const exceeded = checkRateLimit(key, config)
      expect(exceeded.allowed).toBe(false)

      // Перемещаем время вперед на 1.1 секунду
      vi.advanceTimersByTime(1100)

      // Лимит должен сброситься
      const reset = checkRateLimit(key, config)
      expect(reset.allowed).toBe(true)
      expect(reset.remaining).toBe(1)
    })

    it('should track different keys independently', () => {
      const config = { maxRequests: 2, windowMs: 60000 }
      const key1 = 'ip1'
      const key2 = 'ip2'

      // Исчерпываем лимит для key1
      checkRateLimit(key1, config)
      checkRateLimit(key1, config)
      const result1 = checkRateLimit(key1, config)
      expect(result1.allowed).toBe(false)

      // key2 должен иметь полный лимит
      const result2 = checkRateLimit(key2, config)
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(1)
    })
  })

  describe('getClientIP', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1',
        },
      })
      const ip = getClientIP(req)
      expect(ip).toBe('192.168.1.1')
    })

    it('should extract IP from x-real-ip header', () => {
      const req = new Request('http://localhost', {
        headers: {
          'x-real-ip': '192.168.1.2',
        },
      })
      const ip = getClientIP(req)
      expect(ip).toBe('192.168.1.2')
    })

    it('should prefer x-forwarded-for over x-real-ip', () => {
      const req = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1',
          'x-real-ip': '192.168.1.2',
        },
      })
      const ip = getClientIP(req)
      expect(ip).toBe('192.168.1.1')
    })

    it('should return "unknown" if no headers present', () => {
      const req = new Request('http://localhost')
      const ip = getClientIP(req)
      expect(ip).toBe('unknown')
    })
  })

  describe('RATE_LIMIT_CONFIGS', () => {
    it('should have correct limits for different configs', () => {
      expect(RATE_LIMIT_CONFIGS.default.maxRequests).toBe(100)
      expect(RATE_LIMIT_CONFIGS.create.maxRequests).toBe(20)
      expect(RATE_LIMIT_CONFIGS.update.maxRequests).toBe(30)
      expect(RATE_LIMIT_CONFIGS.delete.maxRequests).toBe(10)
      expect(RATE_LIMIT_CONFIGS.auth.maxRequests).toBe(10)
      expect(RATE_LIMIT_CONFIGS.upload.maxRequests).toBe(5)
    })

    it('should have 60 second window for all configs', () => {
      Object.values(RATE_LIMIT_CONFIGS).forEach(config => {
        expect(config.windowMs).toBe(60000)
      })
    })
  })
})


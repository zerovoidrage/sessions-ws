// ws/server/__tests__/audio-validator.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateAudioChunk, cleanupClientTracker, clearAllTrackers } from '../audio-validator'

describe('audio-validator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearAllTrackers() // Очищаем все трекеры между тестами
  })

  describe('validateAudioChunk', () => {
    it('should accept valid audio chunk', () => {
      const chunk = Buffer.alloc(1024) // 1KB chunk
      const result = validateAudioChunk(chunk, 'test-client')
      
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should reject chunk exceeding max size', () => {
      const chunk = Buffer.alloc(33 * 1024) // 33KB (больше лимита 32KB)
      const result = validateAudioChunk(chunk, 'test-client')
      
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('exceeds maximum')
    })

    it('should reject chunk below min size', () => {
      const chunk = Buffer.alloc(0) // Пустой чанк
      const result = validateAudioChunk(chunk, 'test-client', {
        maxChunkSizeBytes: 32 * 1024,
        minChunkSizeBytes: 1,
        maxChunksPerSecond: 100,
      })
      
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('below minimum')
    })

    it('should enforce rate limit for chunks per second', () => {
      const config = {
        maxChunkSizeBytes: 32 * 1024,
        minChunkSizeBytes: 1,
        maxChunksPerSecond: 5, // Низкий лимит для теста
      }

      const chunk = Buffer.alloc(1024)

      // Отправляем 5 чанков (лимит)
      for (let i = 0; i < 5; i++) {
        const result = validateAudioChunk(chunk, 'test-client', config)
        expect(result.valid).toBe(true)
      }

      // 6-й чанк должен быть отклонен
      const result = validateAudioChunk(chunk, 'test-client', config)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Rate limit exceeded')
    })

    it('should reset rate limit after 1 second', () => {
      const config = {
        maxChunkSizeBytes: 32 * 1024,
        minChunkSizeBytes: 1,
        maxChunksPerSecond: 3,
      }

      const chunk = Buffer.alloc(1024)

      // Исчерпываем лимит
      validateAudioChunk(chunk, 'test-client', config)
      validateAudioChunk(chunk, 'test-client', config)
      validateAudioChunk(chunk, 'test-client', config)
      
      const exceeded = validateAudioChunk(chunk, 'test-client', config)
      expect(exceeded.valid).toBe(false)

      // Перемещаем время вперед на 1.1 секунду
      vi.advanceTimersByTime(1100)

      // Лимит должен сброситься
      const reset = validateAudioChunk(chunk, 'test-client', config)
      expect(reset.valid).toBe(true)
    })

    it('should track different clients independently', () => {
      const config = {
        maxChunkSizeBytes: 32 * 1024,
        minChunkSizeBytes: 1,
        maxChunksPerSecond: 2,
      }

      const chunk = Buffer.alloc(1024)

      // Исчерпываем лимит для client1
      validateAudioChunk(chunk, 'client1', config)
      validateAudioChunk(chunk, 'client1', config)
      const result1 = validateAudioChunk(chunk, 'client1', config)
      expect(result1.valid).toBe(false)

      // client2 должен иметь полный лимит
      const result2 = validateAudioChunk(chunk, 'client2', config)
      expect(result2.valid).toBe(true)
    })
  })

  describe('cleanupClientTracker', () => {
    it('should clean up tracker for client', () => {
      const chunk = Buffer.alloc(1024)
      
      // Создаем трекер
      validateAudioChunk(chunk, 'client-to-cleanup')
      
      // Очищаем
      cleanupClientTracker('client-to-cleanup')
      
      // После очистки лимит должен сброситься
      const result = validateAudioChunk(chunk, 'client-to-cleanup')
      expect(result.valid).toBe(true)
    })
  })
})


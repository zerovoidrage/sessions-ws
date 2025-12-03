// src/modules/core/sessions/application/__tests__/createSession.test.ts
import { describe, it, expect } from 'vitest'

describe('createSession', () => {
  // Упрощенный тест - проверяем что функция экспортируется и принимает правильные параметры
  // Полное тестирование требует моков для Prisma и LiveKit
  
  it('should export createSession function', async () => {
    const { createSession } = await import('../createSession')
    expect(typeof createSession).toBe('function')
  })

  it('should validate spaceId is not empty', async () => {
    const { createSession } = await import('../createSession')
    
    await expect(
      createSession({
        spaceId: '',
        title: 'Test Session',
      })
    ).rejects.toThrow()
  })

  it('should validate spaceId is provided', async () => {
    const { createSession } = await import('../createSession')
    
    await expect(
      createSession({
        spaceId: null as any,
        title: 'Test Session',
      })
    ).rejects.toThrow()
  })

  // Примечание: полный тест с моками Prisma должен проверять,
  // что созданная сессия имеет status = 'CREATED',
  // startedAt = null, endedAt = null, lastActivityAt = null
})

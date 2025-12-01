import { PrismaClient } from '@prisma/client'

/**
 * Singleton PrismaClient для WebSocket сервера.
 * 
 * Использует globalThis для предотвращения создания множественных экземпляров
 * в dev-окружении (hot reload) и production (множественные импорты).
 * 
 * Это критично для производительности при высокой нагрузке:
 * - Каждый PrismaClient создает connection pool
 * - Множественные экземпляры = множественные пулы = перегрузка БД
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Управление логированием Prisma через переменную окружения
// PRISMA_LOG_QUERIES=true - включает логи SQL-запросов (по умолчанию выключено даже в dev)
const shouldLogQueries = process.env.PRISMA_LOG_QUERIES === 'true'
const logLevels: Array<'query' | 'error' | 'warn' | 'info'> = ['error', 'warn']
if (shouldLogQueries && process.env.NODE_ENV === 'development') {
  logLevels.push('query')
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevels,
    // Оптимизация для production: уменьшаем логирование
    errorFormat: 'minimal',
  })

// Сохраняем в globalThis для всех окружений (не только dev)
// Это предотвращает создание множественных экземпляров при hot reload и в production
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db
}

// Graceful shutdown: закрываем Prisma при завершении процесса
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await db.$disconnect()
  })
  
  process.on('SIGINT', async () => {
    await db.$disconnect()
    process.exit(0)
  })
  
  process.on('SIGTERM', async () => {
    await db.$disconnect()
    process.exit(0)
  })
}


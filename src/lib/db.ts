import { PrismaClient } from '@prisma/client'

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
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db





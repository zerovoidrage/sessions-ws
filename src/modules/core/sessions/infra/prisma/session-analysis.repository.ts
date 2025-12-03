import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { SessionAnalysis, AnalysisStatus } from '../../domain/session.types'

export interface CreateSessionAnalysisInput {
  sessionId: string
  status?: AnalysisStatus
}

export interface UpdateSessionAnalysisInput {
  status?: AnalysisStatus
  summary?: string | null
  tasksJson?: unknown | null
  risksJson?: unknown | null
}

export async function createSessionAnalysis(
  input: CreateSessionAnalysisInput
): Promise<SessionAnalysis> {
  const analysis = await db.sessionAnalysis.create({
    data: {
      sessionId: input.sessionId,
      status: input.status || 'PENDING',
    },
  })

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    status: analysis.status as AnalysisStatus,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    summary: analysis.summary,
    tasksJson: analysis.tasksJson,
    risksJson: analysis.risksJson,
  }
}

export async function getSessionAnalysisBySessionId(
  sessionId: string
): Promise<SessionAnalysis | null> {
  const analysis = await db.sessionAnalysis.findUnique({
    where: { sessionId },
  })

  if (!analysis) return null

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    status: analysis.status as AnalysisStatus,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    summary: analysis.summary,
    tasksJson: analysis.tasksJson,
    risksJson: analysis.risksJson,
  }
}

export async function updateSessionAnalysis(
  sessionId: string,
  input: UpdateSessionAnalysisInput
): Promise<SessionAnalysis> {
  const updateData: {
    status?: AnalysisStatus
    summary?: string | null
    tasksJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
    risksJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
  } = {}
  
  if (input.status !== undefined) {
    updateData.status = input.status
  }
  if (input.summary !== undefined) {
    updateData.summary = input.summary
  }
  if (input.tasksJson !== undefined) {
    updateData.tasksJson = input.tasksJson === null ? Prisma.JsonNull : input.tasksJson
  }
  if (input.risksJson !== undefined) {
    updateData.risksJson = input.risksJson === null ? Prisma.JsonNull : input.risksJson
  }

  const analysis = await db.sessionAnalysis.update({
    where: { sessionId },
    data: updateData,
  })

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    status: analysis.status as AnalysisStatus,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    summary: analysis.summary,
    tasksJson: analysis.tasksJson,
    risksJson: analysis.risksJson,
  }
}

export async function upsertSessionAnalysis(
  input: CreateSessionAnalysisInput
): Promise<SessionAnalysis> {
  const analysis = await db.sessionAnalysis.upsert({
    where: { sessionId: input.sessionId },
    create: {
      sessionId: input.sessionId,
      status: input.status || 'PENDING',
    },
    update: {
      // При upsert не обновляем статус, если он уже установлен
      ...(input.status && { status: input.status }),
    },
  })

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    status: analysis.status as AnalysisStatus,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    summary: analysis.summary,
    tasksJson: analysis.tasksJson,
    risksJson: analysis.risksJson,
  }
}



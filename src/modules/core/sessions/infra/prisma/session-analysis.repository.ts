import { db } from '@/lib/db'
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
  const analysis = await db.sessionAnalysis.update({
    where: { sessionId },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.summary !== undefined && { summary: input.summary }),
      ...(input.tasksJson !== undefined && { tasksJson: input.tasksJson }),
      ...(input.risksJson !== undefined && { risksJson: input.risksJson }),
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



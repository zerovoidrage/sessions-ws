import { listTranscriptsBySession } from '../prisma/transcripts.repository'
import type { ListTranscriptsBySessionInput } from './transcript.types'

export async function listSessionTranscripts(input: ListTranscriptsBySessionInput) {
  return listTranscriptsBySession(input)
}




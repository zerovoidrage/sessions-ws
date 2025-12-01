import { listTranscriptsBySession } from '../infra/transcripts.repository'
import type { ListTranscriptsBySessionInput } from '../domain/transcript.types'

export async function listSessionTranscripts(input: ListTranscriptsBySessionInput) {
  return listTranscriptsBySession(input)
}



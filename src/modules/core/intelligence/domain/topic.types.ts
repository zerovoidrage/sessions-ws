/**
 * Domain types for Intelligence module - Topics.
 * 
 * Topics are themes or subjects that emerge during a conversation.
 */

export interface AiTopic {
  id: string              // stable id (e.g. slug)
  label: string           // "Authentication", "Production bugs", "Billing refactor", ...
  startedAtSec: number | null // на будущее, можно использовать null пока что
}



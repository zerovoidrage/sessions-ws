// src/types/transcript-state.ts
// Оптимизированная структура состояния транскриптов для высокой производительности

import type { TranscriptMessage } from './transcript'

/**
 * Состояние одного пузыря транскрипта.
 * Хранится в Map для O(1) доступа по utteranceId.
 */
export interface TranscriptBubbleState {
  id: string // Уникальный ID бабла в UI
  sessionSlug: string
  speakerId: string
  speakerName: string
  text: string
  isFinal: boolean
  timestamp: number
  utteranceId: string | null
}

/**
 * Оптимизированная структура состояния транскриптов.
 * 
 * Преимущества:
 * - Map для O(1) доступа по utteranceId
 * - Массив order для хронологического порядка
 * - Минимальные пересоздания объектов при обновлениях
 */
export interface TranscriptState {
  /** Map utteranceId -> TranscriptBubbleState для быстрого доступа */
  byId: Map<string, TranscriptBubbleState>
  /** Массив utteranceId в хронологическом порядке */
  order: string[]
  /** Общее количество сообщений (для метрик) */
  totalCount: number
}

/**
 * Создает пустое состояние транскриптов.
 */
export function createEmptyTranscriptState(): TranscriptState {
  return {
    byId: new Map(),
    order: [],
    totalCount: 0,
  }
}

/**
 * Обновляет состояние транскрипта при получении нового сегмента.
 * 
 * @param state Текущее состояние
 * @param message Новое сообщение транскрипта
 * @returns Новое состояние (с минимальными пересозданиями)
 */
export function updateTranscriptState(
  state: TranscriptState,
  message: TranscriptMessage
): TranscriptState {
  if (!message.text || !message.text.trim()) {
    return state
  }

  const incomingText = message.text.trim()
  const isFinal = Boolean(message.isFinal)
  const utteranceId = message.utteranceId || null
  const now = message.timestamp ?? Date.now()

  // Если есть utteranceId, ищем существующий bubble
  if (utteranceId) {
    const existing = state.byId.get(utteranceId)
    
    if (existing && existing.speakerId === message.speakerId) {
      // Обновляем существующий bubble
      // Дедупликация: если текст и isFinal не изменились - не обновляем
      if (existing.text === incomingText && existing.isFinal === isFinal) {
        return state
      }

      // Создаем новое состояние с обновленным bubble
      const newById = new Map(state.byId)
      newById.set(utteranceId, {
        ...existing,
        text: incomingText,
        isFinal: isFinal || existing.isFinal,
        timestamp: now,
      })

      return {
        byId: newById,
        order: state.order, // order не меняется, так как utteranceId уже есть
        totalCount: state.totalCount,
      }
    }
  }

  // Новый bubble (новый utteranceId или нет utteranceId)
  const newId = `${message.speakerId}-${now}-${Math.random().toString(36).slice(2, 8)}`
  // Используем utteranceId как ключ в Map, если он есть, иначе используем newId
  const bubbleId = utteranceId || newId

  const newBubble: TranscriptBubbleState = {
    id: newId,
    sessionSlug: message.sessionSlug,
    speakerId: message.speakerId,
    speakerName: message.speakerName,
    text: incomingText,
    isFinal,
    timestamp: now,
    utteranceId,
  }

  const newById = new Map(state.byId)
  newById.set(bubbleId, newBubble)

  // Добавляем в order только если это новый bubble (не был в Map)
  const isNewBubble = !state.byId.has(bubbleId)
  const newOrder = isNewBubble ? [...state.order, bubbleId] : state.order

  return {
    byId: newById,
    order: newOrder,
    totalCount: state.totalCount + (isNewBubble ? 1 : 0),
  }
}

/**
 * Получает массив транскриптов в хронологическом порядке.
 * 
 * @param state Состояние транскриптов
 * @returns Массив TranscriptBubbleState в порядке по timestamp
 */
export function getTranscriptsInOrder(state: TranscriptState): TranscriptBubbleState[] {
  return state.order
    .map((id) => state.byId.get(id))
    .filter((bubble): bubble is TranscriptBubbleState => bubble !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
}


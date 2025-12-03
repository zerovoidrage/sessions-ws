/**
 * Метрики для клиентской транскрипции
 * Отслеживает статистику использования транскрипции на клиенте
 */

export interface TranscriptionMetrics {
  sessionSlug: string
  participantIdentity: string
  startedAt: Date
  endedAt?: Date
  totalAudioChunksSent: number
  totalTranscriptsReceived: number
  totalFinalTranscripts: number
  totalPartialTranscripts: number
  totalDurationSeconds: number // Общая длительность активной транскрипции
  totalTranscriptionMinutes: number // Минуты транскрипции (округлённые)
  errors: Array<{
    message: string
    timestamp: Date
  }>
  lastActivityAt: Date
}

class ClientTranscriptionMetrics {
  private metricsMap = new Map<string, TranscriptionMetrics>()

  /**
   * Создаёт или обновляет метрики для участника
   */
  startSession(sessionSlug: string, participantIdentity: string): void {
    const key = this.getKey(sessionSlug, participantIdentity)
    
    const existing = this.metricsMap.get(key)
    if (existing && !existing.endedAt) {
      // Сессия уже запущена
      return
    }

    this.metricsMap.set(key, {
      sessionSlug,
      participantIdentity,
      startedAt: new Date(),
      totalAudioChunksSent: 0,
      totalTranscriptsReceived: 0,
      totalFinalTranscripts: 0,
      totalPartialTranscripts: 0,
      totalDurationSeconds: 0,
      totalTranscriptionMinutes: 0,
      errors: [],
      lastActivityAt: new Date(),
    })

    console.log('[TranscriptionMetrics] Session started', {
      sessionSlug,
      participantIdentity,
      key,
    })
  }

  /**
   * Останавливает сессию и вычисляет финальную длительность
   */
  endSession(sessionSlug: string, participantIdentity: string): TranscriptionMetrics | null {
    const key = this.getKey(sessionSlug, participantIdentity)
    const metrics = this.metricsMap.get(key)

    if (!metrics || metrics.endedAt) {
      return null
    }

    const endedAt = new Date()
    const totalDurationSeconds = Math.floor(
      (endedAt.getTime() - metrics.startedAt.getTime()) / 1000
    )
    const totalTranscriptionMinutes = Math.ceil(totalDurationSeconds / 60) // Округляем вверх

    const finalMetrics: TranscriptionMetrics = {
      ...metrics,
      endedAt,
      totalDurationSeconds,
      totalTranscriptionMinutes,
      lastActivityAt: endedAt,
    }

    this.metricsMap.set(key, finalMetrics)

    console.log('[TranscriptionMetrics] Session ended', {
      sessionSlug,
      participantIdentity,
      totalDurationSeconds,
      totalTranscriptionMinutes,
    })

    return finalMetrics
  }

  /**
   * Увеличивает счётчик отправленных аудио-чанков
   */
  incrementAudioChunks(sessionSlug: string, participantIdentity: string): void {
    const key = this.getKey(sessionSlug, participantIdentity)
    const metrics = this.metricsMap.get(key)
    
    if (!metrics || metrics.endedAt) {
      return
    }

    metrics.totalAudioChunksSent++
    metrics.lastActivityAt = new Date()

    // Логируем каждые 100 чанков
    if (metrics.totalAudioChunksSent % 100 === 0) {
      console.log('[TranscriptionMetrics] Audio chunks sent', {
        sessionSlug,
        participantIdentity,
        count: metrics.totalAudioChunksSent,
      })
    }
  }

  /**
   * Увеличивает счётчик полученных транскриптов
   */
  incrementTranscripts(
    sessionSlug: string,
    participantIdentity: string,
    isFinal: boolean
  ): void {
    const key = this.getKey(sessionSlug, participantIdentity)
    const metrics = this.metricsMap.get(key)
    
    if (!metrics || metrics.endedAt) {
      return
    }

    metrics.totalTranscriptsReceived++
    metrics.lastActivityAt = new Date()

    if (isFinal) {
      metrics.totalFinalTranscripts++
    } else {
      metrics.totalPartialTranscripts++
    }
  }

  /**
   * Записывает ошибку
   */
  recordError(
    sessionSlug: string,
    participantIdentity: string,
    message: string
  ): void {
    const key = this.getKey(sessionSlug, participantIdentity)
    const metrics = this.metricsMap.get(key)
    
    if (!metrics || metrics.endedAt) {
      return
    }

    metrics.errors.push({
      message,
      timestamp: new Date(),
    })

    console.error('[TranscriptionMetrics] Error recorded', {
      sessionSlug,
      participantIdentity,
      message,
      totalErrors: metrics.errors.length,
    })
  }

  /**
   * Получает текущие метрики для участника
   */
  getMetrics(
    sessionSlug: string,
    participantIdentity: string
  ): TranscriptionMetrics | null {
    const key = this.getKey(sessionSlug, participantIdentity)
    return this.metricsMap.get(key) || null
  }

  /**
   * Получает все активные сессии
   */
  getActiveSessions(): TranscriptionMetrics[] {
    return Array.from(this.metricsMap.values()).filter((m) => !m.endedAt)
  }

  /**
   * Очищает завершённые сессии старше указанного времени (в часах)
   */
  cleanupOldSessions(maxAgeHours: number = 24): void {
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000
    let cleaned = 0

    for (const [key, metrics] of this.metricsMap.entries()) {
      if (metrics.endedAt && metrics.endedAt.getTime() < cutoffTime) {
        this.metricsMap.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log('[TranscriptionMetrics] Cleaned up old sessions', {
        cleaned,
        remaining: this.metricsMap.size,
      })
    }
  }

  private getKey(sessionSlug: string, participantIdentity: string): string {
    return `${sessionSlug}:${participantIdentity}`
  }
}

// Singleton instance
export const clientTranscriptionMetrics = new ClientTranscriptionMetrics()

// Периодическая очистка старых метрик (каждый час)
if (typeof window !== 'undefined') {
  setInterval(() => {
    clientTranscriptionMetrics.cleanupOldSessions(24)
  }, 60 * 60 * 1000)
}


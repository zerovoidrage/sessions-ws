/**
 * Декодер аудио для серверной транскрипции.
 * 
 * Декодирует Opus аудио в PCM16 16kHz моно для Gladia.
 * 
 * ВАЖНО: Этот модуль должен использоваться ТОЛЬКО на сервере (Node.js).
 * @discordjs/opus содержит нативные зависимости и не может работать в браузере.
 */

// Проверяем, что мы в Node.js окружении
if (typeof window !== 'undefined') {
  throw new Error('AudioDecoder can only be used in Node.js environment, not in browser')
}

// @discordjs/opus - CommonJS модуль, используем createRequire для ESM
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { OpusEncoder } = require('@discordjs/opus')

export class AudioDecoder {
  private decoder: typeof OpusEncoder | null = null
  private readonly sampleRate = 16000 // Gladia требует 16kHz
  private readonly channels = 1 // Моно

  constructor() {
    try {
      // Инициализируем Opus декодер
      // @discordjs/opus требует нативные зависимости
      // ВАЖНО: Этот код выполняется только на сервере благодаря проверке выше
      this.decoder = new OpusEncoder(this.sampleRate, this.channels)
      console.log('[AudioDecoder] Opus decoder initialized')
    } catch (error) {
      console.error('[AudioDecoder] Failed to initialize Opus decoder:', error)
      console.warn('[AudioDecoder] Audio decoding will not work. Make sure @discordjs/opus is properly installed.')
      this.decoder = null
    }
  }

  /**
   * Декодирует Opus аудио в PCM16.
   * 
   * @param opusBuffer - Буфер с Opus данными
   * @returns PCM16 буфер (16kHz, моно) или null если декодер не инициализирован
   */
  decodeOpusToPCM16(opusBuffer: Buffer): Buffer | null {
    if (!this.decoder) {
      console.warn('[AudioDecoder] Decoder not initialized, cannot decode Opus')
      return null
    }

    try {
      // Декодируем Opus → PCM16
      const pcmBuffer = this.decoder.decode(opusBuffer)
      return Buffer.from(pcmBuffer)
    } catch (error) {
      console.error('[AudioDecoder] Error decoding Opus:', error)
      return null
    }
  }

  /**
   * Декодирует массив Opus буферов в один PCM16 буфер.
   * 
   * @param opusBuffers - Массив Opus буферов
   * @returns Объединённый PCM16 буфер или null
   */
  decodeMultipleOpusBuffers(opusBuffers: Buffer[]): Buffer | null {
    if (!this.decoder || opusBuffers.length === 0) {
      return null
    }

    try {
      // Декодируем все буферы и объединяем
      const decodedBuffers: Buffer[] = []
      
      for (const opusBuffer of opusBuffers) {
        const decoded = this.decodeOpusToPCM16(opusBuffer)
        if (decoded) {
          decodedBuffers.push(decoded)
        }
      }

      if (decodedBuffers.length === 0) {
        return null
      }

      // Объединяем все декодированные буферы
      return Buffer.concat(decodedBuffers)
    } catch (error) {
      console.error('[AudioDecoder] Error decoding multiple Opus buffers:', error)
      return null
    }
  }

  /**
   * Проверяет, инициализирован ли декодер.
   */
  isInitialized(): boolean {
    return this.decoder !== null
  }

  /**
   * Освобождает ресурсы декодера.
   */
  destroy(): void {
    if (this.decoder) {
      try {
        // @discordjs/opus может иметь метод destroy или cleanup
        // Проверяем наличие метода перед вызовом
        if (typeof (this.decoder as any).destroy === 'function') {
          (this.decoder as any).destroy()
        }
      } catch (error) {
        console.error('[AudioDecoder] Error destroying decoder:', error)
      }
      this.decoder = null
    }
  }
}


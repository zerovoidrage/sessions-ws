/**
 * Аудио процессор для серверной транскрипции.
 * 
 * Обрабатывает PCM16 аудио чанки и отправляет их в Gladia.
 * Поддерживает микширование нескольких аудио потоков.
 */

export interface AudioChunk {
  data: Buffer | ArrayBuffer
  sampleRate: number
  channels: number
  timestamp: number
}

export class AudioProcessor {
  private sampleRate = 16000
  private channels = 1
  private buffer: Buffer[] = []
  private bufferSize = 0
  private readonly targetChunkSize = 3200 // ~200ms при 16kHz (16000 * 0.2 * 1 channel * 2 bytes)

  /**
   * Добавляет аудио чанк в буфер.
   * Когда буфер достигает целевого размера, возвращает готовый чанк для отправки в Gladia.
   */
  processChunk(chunk: AudioChunk): Buffer | null {
    // Конвертируем в Buffer если нужно
    const buffer = Buffer.isBuffer(chunk.data) 
      ? chunk.data 
      : Buffer.from(chunk.data)

    // Добавляем в буфер
    this.buffer.push(buffer)
    this.bufferSize += buffer.length

    // Если буфер достиг целевого размера, возвращаем готовый чанк
    if (this.bufferSize >= this.targetChunkSize) {
      const result = Buffer.concat(this.buffer)
      this.buffer = []
      this.bufferSize = 0
      return result
    }

    return null
  }

  /**
   * Принудительно возвращает все данные из буфера (для финализации).
   */
  flush(): Buffer | null {
    if (this.bufferSize === 0) {
      return null
    }

    const result = Buffer.concat(this.buffer)
    this.buffer = []
    this.bufferSize = 0
    return result
  }

  /**
   * Микширует несколько PCM16 аудио буферов в один.
   * Простое суммирование с нормализацией.
   */
  static mixBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) {
      return Buffer.alloc(0)
    }

    if (buffers.length === 1) {
      return buffers[0]
    }

    // Находим минимальную длину
    const minLength = Math.min(...buffers.map(b => b.length))

    // Создаём результирующий буфер
    const result = Buffer.alloc(minLength)

    // Суммируем все буферы
    for (let i = 0; i < minLength; i += 2) {
      let sum = 0
      for (const buffer of buffers) {
        const sample = buffer.readInt16LE(i)
        sum += sample
      }
      
      // Нормализация (делим на количество буферов, чтобы избежать клиппинга)
      const normalized = Math.round(sum / buffers.length)
      
      // Ограничиваем значение до диапазона Int16
      const clamped = Math.max(-32768, Math.min(32767, normalized))
      
      result.writeInt16LE(clamped, i)
    }

    return result
  }
}


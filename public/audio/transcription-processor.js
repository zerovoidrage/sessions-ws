/**
 * AudioWorklet processor для обработки аудио в транскрипции.
 * Заменяет устаревший ScriptProcessorNode.
 * 
 * Этот файл должен быть доступен по URL /audio/transcription-processor.js
 */

class TranscriptionProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    console.log('[TranscriptionProcessor] Initialized')
  }

  /**
   * Обрабатывает аудио данные и отправляет их в основной поток.
   * 
   * @param {Float32Array[][]} inputs - Массив входных каналов
   * @param {Float32Array[][]} outputs - Массив выходных каналов (не используется)
   * @param {Object} parameters - Параметры процессора (не используются)
   * @returns {boolean} true, чтобы процессор продолжал работать
   */
  process(inputs, outputs, parameters) {
    // Читаем аудио данные из первого входного канала
    const input = inputs[0]
    if (input && input.length > 0) {
      const inputChannel = input[0] // Первый канал (моно)
      
      if (inputChannel && inputChannel.length > 0) {
        // Копируем данные в новый Float32Array для передачи в основной поток
        // (нельзя передавать напрямую, так как буфер может быть переиспользован)
        const audioData = new Float32Array(inputChannel.length)
        audioData.set(inputChannel)
        
        // Отправляем данные в основной поток
        this.port.postMessage({
          type: 'audio-data',
          buffer: audioData.buffer, // Передаем ArrayBuffer для эффективности
          length: audioData.length,
        })
      }
    }

    // Возвращаем true, чтобы процессор продолжал работать
    return true
  }
}

// Регистрируем процессор
registerProcessor('transcription-processor', TranscriptionProcessor)



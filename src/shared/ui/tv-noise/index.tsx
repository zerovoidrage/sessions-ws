'use client'

import { useEffect, useRef } from 'react'

export interface TVNoiseProps {
  isActive: boolean
  duration?: number
}

export function TVNoise({ isActive, duration = 2000 }: TVNoiseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()

  useEffect(() => {
    if (!isActive || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Устанавливаем размеры canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Генерируем шум
    const generateNoise = () => {
      if (!ctx) return
      
      const imageData = ctx.createImageData(canvas.width, canvas.height)
      const data = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255
        data[i] = value     // R
        data[i + 1] = value // G
        data[i + 2] = value // B
        data[i + 3] = 255   // A
      }

      ctx.putImageData(imageData, 0, 0)
    }

    // Анимация шума
    const animate = () => {
      generateNoise()
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div
        className="absolute inset-0"
        style={{ mixBlendMode: 'screen' }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{
            filter: 'contrast(1.2) brightness(1.1)',
          }}
        />
      </div>
    </div>
  )
}


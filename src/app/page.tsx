'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Button } from '@/shared/ui/button'

const texts = [
  'say goodbye, google meet & zoom',
  'sessions.ai - Native AI Meeting OS',
]

export default function HomePage() {
  const router = useRouter()
  const [displayText, setDisplayText] = useState('')
  const [currentTextIndex, setCurrentTextIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [charIndex, setCharIndex] = useState(0)

  useEffect(() => {
    const currentText = texts[currentTextIndex]
    
    if (!isDeleting && charIndex < currentText.length) {
      // Печатаем
      const timeout = setTimeout(() => {
        setDisplayText(currentText.substring(0, charIndex + 1))
        setCharIndex(charIndex + 1)
      }, 30)
      return () => clearTimeout(timeout)
    } else if (!isDeleting && charIndex === currentText.length) {
      // Дождались конца текста, ждем 1 секунду перед стиранием
      const timeout = setTimeout(() => {
        setIsDeleting(true)
      }, 3000)
      return () => clearTimeout(timeout)
    } else if (isDeleting && charIndex > 0) {
      // Стираем
      const timeout = setTimeout(() => {
        setDisplayText(currentText.substring(0, charIndex - 1))
        setCharIndex(charIndex - 1)
      }, 20)
      return () => clearTimeout(timeout)
    } else if (isDeleting && charIndex === 0) {
      // Закончили стирать, ждем немного перед началом следующего текста
      const timeout = setTimeout(() => {
        setIsDeleting(false)
        setCurrentTextIndex((prev) => (prev + 1) % texts.length)
        setCharIndex(0)
        setDisplayText('')
      }, 500)
      return () => clearTimeout(timeout)
    }
  }, [charIndex, isDeleting, currentTextIndex])

  const handleSignUp = () => {
    router.push('/auth/signin')
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="text-center animate-fade-in-up">
        <h1 className="text-6xl md:text-9xl lg:text-xl leading-tight text-white-900 mb-2">
          {displayText}
          <span className="inline-block w-0.5 h-[1em] bg-white-900 ml-1 animate-blink" />
        </h1>
        <div className="mb-20" />
        <Button
          onClick={handleSignUp}
          variant="primary"
          size="lg"
        >
          enter the OS
        </Button>
      </div>
    </div>
  )
}

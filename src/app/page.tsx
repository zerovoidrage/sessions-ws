'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Plus } from '@phosphor-icons/react'
import { StartSessionButton } from '@/shared/ui/start-session-button'
import { TVNoise } from '@/shared/ui/tv-noise'

const texts = [
  'say goodbye google meet & zoom',
  'sessions.ai - Real-time AI-Driven Meeting OS',
]

export default function HomePage() {
  const router = useRouter()
  const [displayText, setDisplayText] = useState('')
  const [currentTextIndex, setCurrentTextIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [charIndex, setCharIndex] = useState(0)
  const [isNoiseActive, setIsNoiseActive] = useState(false)

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

  const handleSignIn = () => {
    setIsNoiseActive(true)
    setTimeout(() => {
      setIsNoiseActive(false)
    }, 2000) // 2 секунды
  }

  const handleStartSession = () => {
    setIsNoiseActive(true)
    setTimeout(() => {
      setIsNoiseActive(false)
    }, 2000) // 2 секунды
  }

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col text-sm">
      {/* Header */}
      <header className="w-full px-3 py-3 flex items-center justify-between">
        <Image
          src="/img/logo.svg"
          alt="Logo"
          width={16}
          height={16}
          className="h-auto"
        />
        <button
          onClick={handleSignIn}
          className="text-sm text-white-600 hover:text-white-900 transition-colors"
        >
          {'>'} enter OS
        </button>
      </header>

      {/* Main content - centered title with typing animation */}
      <div className="flex-1 flex items-center justify-center">
        <h1 className="text-[18px] tracking-[-0.02em] text-white-900 leading-[1.5] text-center flex items-center gap-1">
          {displayText}
          <Image
            src="/img/logo-w.svg"
            alt=""
            width={16}
            height={16}
            className={`inline-block ml-0 animate-blink ${
              currentTextIndex === 0 ? 'opacity-60' : 'opacity-100'
            }`}
          />
        </h1>
      </div>

      {/* Start Session Button - centered at bottom with 60px margin */}
      <div className="flex justify-center mb-[60px] ">
        <StartSessionButton onClick={handleStartSession} className="justify-between px-6">
          <span>start AI session</span>
          <Plus size={14} />
        </StartSessionButton>
      </div>

      {/* TV Noise Effect */}
      <TVNoise isActive={isNoiseActive} duration={2000} />
    </div>
  )
}

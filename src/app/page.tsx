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
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory scrollbar-hide bg-surface-900 text-sm">
      {/* First Section - Full Screen */}
      <section className="h-screen snap-start snap-always flex flex-col">
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
      </section>

      {/* Second Section - Full Screen with Text */}
      <section className="h-screen snap-start snap-always flex items-center justify-center px-4 bg-white-900">
        <div className="max-w-lg w-full text-[16px] text-surface-900 text-center space-y-4 leading-tight flex flex-col items-center">
          <Image
            src="/img/logo-black.svg"
            alt="Logo"
            width={32}
            height={17}
            className="mb-8"
          />
          <p>Video meetings today are broken.</p>
          
          <p>They show faces, they record audio — but they don&apos;t understand anything.</p>
          
          <p>Teams leave with scattered notes, forgotten decisions, and lost context.</p>
          
          <p>Sessions.ai is the first Real-Time AI-Driven Meeting OS.</p>
          
          <p>Not recording. Not a summary.</p>
          
          <p>An operating system that thinks during the meeting.</p>
          
          <p>It listens, understands topics, captures decisions, creates tasks, detects risks — all in real time.</p>
          
          <p>And after the call, you instantly get a clean action plan, an episode timeline, and a living workspace that organizes itself.</p>
          
          <p>Teams talk. Sessions.ai does the thinking.</p>
        </div>
      </section>

      {/* TV Noise Effect */}
      <TVNoise isActive={isNoiseActive} duration={2000} />
    </div>
  )
}

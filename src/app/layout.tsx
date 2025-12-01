import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Providers } from '@/components/providers/Providers'
import { ErrorBoundary } from '@/shared/ui/error-boundary'

const suisseIntl = localFont({
  src: [
    {
      path: '../../public/fonts/SuisseIntl-Light.otf',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../../public/fonts/SuisseIntl-Regular.otf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/SuisseIntl-Book.otf',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../public/fonts/SuisseIntl-Medium.otf',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../public/fonts/SuisseIntl-SemiBold.otf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-suisse-intl',
  display: 'swap',
  fallback: ['sans-serif'],
})

export const metadata: Metadata = {
  title: 'Rooms - Video Calls',
  description: 'Video calls powered by LiveKit',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={suisseIntl.variable}>
      <body className="font-suisse-intl" suppressHydrationWarning>
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}


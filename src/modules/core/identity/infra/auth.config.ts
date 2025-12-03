import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { db } from '@/lib/db'

// Пастельные цвета для аватаров
const PASTEL_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E0BBE4', '#FEC8C1', '#FFD9B3', '#F4E4BC', '#C5E1A5',
  '#B2DFDB', '#BBDEFB', '#C5CAE9', '#D1C4E9', '#F8BBD0',
]

function generateNoAvatarColor(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % PASTEL_COLORS.length
  return PASTEL_COLORS[index]
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: {
    strategy: 'jwt', // Используем JWT sessions для работы с middleware
    maxAge: 30 * 24 * 60 * 60, // 30 дней в секундах
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 дней в секундах
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // Разрешаем связывать OAuth аккаунты с существующими пользователями по email
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // PrismaAdapter сам создаст пользователя и Account
      // Обновляем дополнительные поля при первой авторизации
      if (user.email) {
        const dbUser = await db.user.findUnique({
          where: { email: user.email },
        })
        
        if (dbUser) {
          const updates: { displayName?: string; noAvatarColor?: string } = {}
          
          if (!dbUser.displayName && user.name) {
            updates.displayName = user.name
          }
          
          if (!dbUser.noAvatarColor && user.email) {
            updates.noAvatarColor = generateNoAvatarColor(user.email)
          }
          
          if (Object.keys(updates).length > 0) {
            await db.user.update({
              where: { id: dbUser.id },
              data: updates,
            })
          }
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      // При первой авторизации сохраняем ID пользователя в токен
      if (user) {
        token.userId = user.id
      }
      return token
    },
    async session({ session, token }) {
      // С JWT sessions используем token
      if (session.user && token.userId) {
        session.user.id = token.userId as string
        
        const dbUser = await db.user.findUnique({
          where: { id: token.userId as string },
          select: {
            displayName: true,
            avatarUrl: true,
            noAvatarColor: true,
            activeSpaceId: true,
            email: true,
            name: true,
          },
        })
        
        if (dbUser) {
          // Обновляем дополнительные поля, если они еще не установлены
          // ВАЖНО: НЕ используем session.user.image из Google - аватар только через Cloudinary или noAvatarColor
          const updates: { displayName?: string; noAvatarColor?: string } = {}
          
          if (!dbUser.displayName && dbUser.name) {
            updates.displayName = dbUser.name
          }
          
          if (!dbUser.noAvatarColor && dbUser.email) {
            updates.noAvatarColor = generateNoAvatarColor(dbUser.email)
          }
          
          // Применяем обновления, если они есть
          if (Object.keys(updates).length > 0) {
            await db.user.update({
              where: { id: token.userId as string },
              data: updates,
            })
            
            // Обновляем значения для текущей сессии
            if (updates.displayName) dbUser.displayName = updates.displayName
            if (updates.noAvatarColor) dbUser.noAvatarColor = updates.noAvatarColor
          }
          
          session.user.displayName = dbUser.displayName
          session.user.avatarUrl = dbUser.avatarUrl // Может быть null - это нормально, будет использован noAvatarColor
          session.user.noAvatarColor = dbUser.noAvatarColor
          session.user.activeSpaceId = dbUser.activeSpaceId
        }
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NEXTAUTH_URL?.startsWith('https://') ?? false,
}


import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/shared/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        'suisse-intl': ['var(--font-suisse-intl)', 'sans-serif'],
      },
      fontWeight: {
        light: '300',
        normal: '400',
        book: '500',
        medium: '600',
        semibold: '700',
      },
      colors: {
        white: {
          500: '#CCCCCC',
          600: '#B3B3B3',
          700: '#999999',
          800: '#808080',
          900: '#FFFFFF',
        },
        surface: {
          800: '#0a0a0a',
          900: '#000000',
        },
        onsurface: {
          700: '#2D2E31',
          800: '#1D1E20',
          900: '#1A1A1A',
          950: 'rgb(15, 15, 15)',
        },
        brand: {
          red: '#8B0000',
          coral: '#FF7F50',
          green: '#00FF7F',
          olive: '#7FFF00',
          yellow: '#FFFF7F',
        },
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        full: '9999px',
      },
      keyframes: {
        'slide-up-fade-in': {
          '0%': {
            opacity: '0',
            transform: 'translateY(20px) scale(0.95)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
          },
        },
      },
      animation: {
        'slide-up-fade-in': 'slide-up-fade-in 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
      },
    },
  },
  plugins: [],
}
export default config


// vitest.setup.ts
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Мокаем window.Sentry для тестов
global.window = {
  ...global.window,
  Sentry: {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  },
} as any




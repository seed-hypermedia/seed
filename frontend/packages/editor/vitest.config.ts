import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 30000,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})

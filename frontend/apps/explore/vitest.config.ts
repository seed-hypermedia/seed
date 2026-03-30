import {defineConfig} from 'vitest/config'

export default defineConfig({
  define: {
    'process.env': {},
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

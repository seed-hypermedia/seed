import {resolve} from 'path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 10000, // 10 seconds
    setupFiles: ['fake-indexeddb/auto'],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})

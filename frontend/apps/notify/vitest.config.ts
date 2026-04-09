import path from 'path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
    },
  },
  test: {
    testTimeout: 10000, // 10 seconds
    setupFiles: ['fake-indexeddb/auto'],
    // watch: false, // Disable watch mode
  },
})

import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 10000, // 10 seconds
    setupFiles: ['fake-indexeddb/auto'],
    // watch: false, // Disable watch mode
  },
})

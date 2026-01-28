import {defineConfig} from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  test: {
    testTimeout: 10000, // 10 seconds
    setupFiles: ['fake-indexeddb/auto'],
    // watch: false, // Disable watch mode
  },
  resolve: {
    alias: {
      '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
      '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@': path.resolve(__dirname, './app'),
    },
  },
})

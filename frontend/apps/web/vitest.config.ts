import {defineConfig} from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import * as path from 'path'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    dedupe: ['graphql', '@pothos/core'], // Prevent duplicate graphql modules
    alias: {
      '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
      '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
  test: {
    testTimeout: 30000, // 30 seconds (increased for integration tests with daemon)
    setupFiles: ['fake-indexeddb/auto'],
    // watch: false, // Disable watch mode
  },
})

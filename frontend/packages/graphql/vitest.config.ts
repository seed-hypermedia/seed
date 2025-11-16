import {defineConfig} from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  resolve: {
    dedupe: ['graphql', '@pothos/core'],
    alias: {
      '@shm/shared': path.resolve(__dirname, '../shared/src'),
      '@shm/editor': path.resolve(__dirname, '../editor/src'),
      '@shm/ui': path.resolve(__dirname, '../ui/src'),
      '@': path.resolve(__dirname, '../../apps/web/app'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
  },
})

import {defineConfig} from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@shm/shared': path.resolve(__dirname, '../shared/src'),
      '@shm/ui': path.resolve(__dirname, '../ui/src'),
    },
  },
})
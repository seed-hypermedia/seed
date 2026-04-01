import react from '@vitejs/plugin-react'
import {defineConfig} from 'vitest/config'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@shm/editor': path.resolve(__dirname, 'src'),
      '@shm/shared': path.resolve(__dirname, '../shared/src'),
      '@shm/ui': path.resolve(__dirname, '../ui/src'),
      '@seed-hypermedia/client': path.resolve(__dirname, '../client/src'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
})

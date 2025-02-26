import react from '@vitejs/plugin-react'
import path from 'path'
import {defineConfig} from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['@shm/shared', '@shm/shared/*', '@shm/ui', 'react', 'react-dom'],
    alias: {
      '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
    },
  },
})

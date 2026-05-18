import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

const workspacePath = (path: string) => new URL(path, import.meta.url).pathname

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
  },
  resolve: {
    dedupe: ['@seed-hypermedia/client', '@shm/shared', '@shm/shared/*', '@shm/ui', '@shm/ui/*', 'react', 'react-dom'],
    alias: {
      '@seed-hypermedia/client': workspacePath('../../packages/client/src'),
      '@shm/shared': workspacePath('../../packages/shared/src'),
      '@shm/ui': workspacePath('../../packages/ui/src'),
    },
  },
})

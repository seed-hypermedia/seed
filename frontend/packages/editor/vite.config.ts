import react from '@vitejs/plugin-react'
import path from 'path'
import {defineConfig} from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths({root: path.resolve(__dirname, '../..')})],
  resolve: {
    dedupe: [
      '@shm/shared',
      '@shm/shared/*',
      '@shm/editor',
      '@shm/editor/*',
      '@shm/ui',
      '@shm/ui/*',
      '@seed-hypermedia/client',
      'react',
      'react-dom',
    ],
  },
})

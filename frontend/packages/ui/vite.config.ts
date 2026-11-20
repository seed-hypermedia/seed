import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths({root: __dirname})],
  resolve: {
    alias: {
      '@shm/shared': path.resolve(__dirname, '../shared/src'),
      '@seed-hypermedia/client': path.resolve(__dirname, '../client/src'),
      '@shm/ui': path.resolve(__dirname, './src'),
    },
    dedupe: ['@shm/shared', '@shm/shared/*', '@shm/ui', '@shm/ui/*', '@seed-hypermedia/client', 'react', 'react-dom'],
  },
})

import {fileURLToPath} from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths({projects: [fileURLToPath(new URL('./tsconfig.json', import.meta.url))]}),
  ],
  define: {'process.env': '{}'},
  resolve: {
    alias: {
      '@shm/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
      '@shm/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
      '@seed-hypermedia/client': fileURLToPath(new URL('../../packages/client/src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@shm/ui', '@shm/shared', '@seed-hypermedia/client'],
  },
  test: {include: ['src/**/*.test.ts'], environment: 'node'},
})

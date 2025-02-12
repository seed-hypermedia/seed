import path from 'path'
import {defineConfig} from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [],
    },
  },
  plugins: [
    tsConfigPaths({
      root: '../../',
    }),
  ],
  resolve: {
    dedupe: ['@shm/shared', '@shm/shared/*', '@shm/ui', 'react', 'react-dom'],
    alias: {
      '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
    },
  },
})

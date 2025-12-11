import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'test-app'),
  define: {
    // TODO: Define process.env for dependencies
    'process.env': {
      NODE_ENV: JSON.stringify('development'),
      VITE_GATEWAY_URL: JSON.stringify('https://hyper.media'),
    },
  },
  resolve: {
    dedupe: [
      '@shm/shared',
      '@shm/shared/*',
      '@shm/editor',
      '@shm/editor/*',
      '@shm/ui',
      '@shm/ui/*',
      'react',
      'react-dom',
    ],
    alias: {
      '@': path.resolve(__dirname, '../src'),
      '@shm/shared': path.resolve(__dirname, '../../shared/src'),
      '@shm/editor': path.resolve(__dirname, '../src'),
      '@shm/ui': path.resolve(__dirname, '../../ui/src'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})

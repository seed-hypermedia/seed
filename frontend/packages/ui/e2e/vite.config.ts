import react from '@vitejs/plugin-react'
import path from 'path'
import {defineConfig} from 'vite'

// Isolated Vite test-app for the @shm/ui schema-editor E2E suite. Mirrors the
// @shm/editor harness (frontend/packages/editor/e2e), but mounts the real
// DocumentMetadataView / Onyx schema-editor components. Port 5181 (5180 is the
// editor harness) so both can run concurrently.
//
// Unlike the editor harness we resolve the workspace packages with explicit
// aliases rather than vite-tsconfig-paths (which isn't hoisted to @shm/ui).
const shared = path.resolve(__dirname, '../../shared/src')
const ui = path.resolve(__dirname, '../src')
const client = path.resolve(__dirname, '../../client/src')

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'test-app'),
  define: {
    'process.env': {
      NODE_ENV: JSON.stringify('development'),
      VITE_GATEWAY_URL: JSON.stringify('https://hyper.media'),
    },
  },
  resolve: {
    alias: [
      {find: /^@shm\/shared$/, replacement: path.join(shared, 'index.ts')},
      {find: /^@shm\/shared\//, replacement: `${shared}/`},
      {find: /^@shm\/ui\//, replacement: `${ui}/`},
      {find: /^@seed-hypermedia\/client$/, replacement: path.join(client, 'index.ts')},
      {find: /^@seed-hypermedia\/client\//, replacement: `${client}/`},
      {find: /^@\//, replacement: `${ui}/`},
    ],
    dedupe: ['@shm/shared', '@shm/ui', '@seed-hypermedia/client', '@tanstack/react-query', 'react', 'react-dom'],
  },
  server: {
    port: 5181,
    strictPort: true,
  },
})

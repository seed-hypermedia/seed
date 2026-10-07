import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'

const here = import.meta.dirname
const frontend = resolve(here, '../../../../frontend')
const localAliases = resolve(here, 'aliases.local.json')

/**
 * Vite server for previewing real @shm/ui components with fixture data.
 *
 * `aliases.local.json` (gitignored) maps module ids to fixture files in this directory, e.g.
 * `{"@shm/shared/models/entity": "./fixture-entity.local.ts"}`, so data hooks can be replaced without touching source.
 */
export default {
  root: here,
  plugins: [react(), tailwind()],
  define: {'process.env': {}, global: 'globalThis'},
  resolve: {
    alias: [
      ...Object.entries(existsSync(localAliases) ? JSON.parse(readFileSync(localAliases, 'utf8')) : {}).map(
        ([find, file]) => ({find, replacement: resolve(here, file)}),
      ),
      {find: '@shm/shared', replacement: resolve(frontend, 'packages/shared/src')},
      {find: '@shm/ui', replacement: resolve(frontend, 'packages/ui/src')},
      {find: '@seed-hypermedia/client', replacement: resolve(frontend, 'packages/client/src')},
    ],
  },
  server: {port: 5199, strictPort: true},
}

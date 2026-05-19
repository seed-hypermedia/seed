import {defineConfig} from 'vitest/config'

const workspacePath = (path: string) => new URL(path, import.meta.url).pathname

export default defineConfig({
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      '@seed-hypermedia/client': workspacePath('../../packages/client/src'),
      '@shm/shared': workspacePath('../../packages/shared/src'),
      '@shm/ui': workspacePath('../../packages/ui/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

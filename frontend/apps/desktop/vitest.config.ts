import {resolve} from 'path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 10000, // 10 seconds
    setupFiles: ['fake-indexeddb/auto'],
    environment: 'jsdom',
  },
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: resolve(__dirname, './src/$1'),
      },
      {
        find: /^@shm\/ui$/,
        replacement: resolve(__dirname, '../../packages/ui/src/index.tsx'),
      },
      {
        find: /^@shm\/ui\/(.*)$/,
        replacement: resolve(__dirname, '../../packages/ui/src/$1'),
      },
      {
        find: /^@shm\/shared$/,
        replacement: resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
      {
        find: /^@shm\/shared\/(.*)$/,
        replacement: resolve(__dirname, '../../packages/shared/src/$1'),
      },
      {
        find: /^@shm\/editor\/(.*)$/,
        replacement: resolve(__dirname, '../../packages/editor/src/$1'),
      },
    ],
  },
})

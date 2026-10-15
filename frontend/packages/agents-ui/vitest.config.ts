import {defineConfig} from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@seed-hypermedia/agents-protocol': path.resolve(__dirname, '../../../agents/protocol/src/index.ts'),
      '@seed-hypermedia/client': path.resolve(__dirname, '../client/src'),
      '@shm/shared': path.resolve(__dirname, '../shared/src'),
      '@shm/ui': path.resolve(__dirname, '../ui/src'),
      '@shm/editor': path.resolve(__dirname, '../editor/src'),
    },
  },
})

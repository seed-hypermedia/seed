import {defineConfig} from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@seed-hypermedia/client': path.resolve(__dirname, '../client/src'),
    },
  },
})

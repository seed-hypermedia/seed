import {defineConfig} from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@seed-hypermedia/client': path.resolve(__dirname, '../client/src'),
    },
  },
})

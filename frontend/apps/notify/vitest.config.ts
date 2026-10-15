import path from 'path'
import {defineConfig} from 'vitest/config'

// Tests that open the real SQLite database (bun:sqlite) are named `*.bun.test.ts` and run under
// `bun test`; vitest runs the rest (they mock the database module).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
    },
  },
  test: {
    testTimeout: 10000, // 10 seconds
    exclude: ['**/node_modules/**', '**/*.bun.test.ts'],
  },
})

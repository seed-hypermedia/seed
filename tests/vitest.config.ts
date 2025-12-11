import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120_000, // 2 minutes for integration tests
    hookTimeout: 120_000,
    include: ['**/*.integration.test.ts'],
    globals: true,
    // Run integration tests sequentially to avoid shared resource conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})

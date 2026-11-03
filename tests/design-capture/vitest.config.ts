import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['design-capture/capture.test.ts'],
  },
})

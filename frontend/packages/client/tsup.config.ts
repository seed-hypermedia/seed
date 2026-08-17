import {defineConfig} from 'tsup'

export default defineConfig({
  // Every module gets its own entry so the published `./*` subpath export always
  // resolves to a real runtime file, not just a stray `.d.ts`.
  entry: ['src/*.ts', '!src/*.test.ts'],
  format: ['esm'],
  dts: false,
  splitting: true,
  clean: true,
  external: ['zod'],
})

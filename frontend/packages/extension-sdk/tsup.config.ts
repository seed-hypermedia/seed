import {defineConfig} from 'tsup'

export default defineConfig({
  // Every module gets its own entry so the published `./*` subpath export always
  // resolves to a real runtime file, not just a stray `.d.ts`.
  entry: ['src/*.ts', '!src/*.test.ts'],
  format: ['esm'],
  dts: false,
  splitting: true,
  clean: true,
  // The protocol constants come from @seed-hypermedia/client (which brings zod);
  // both stay external so consumers share a single copy.
  external: ['zod', '@seed-hypermedia/client'],
})

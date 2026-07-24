import {defineConfig} from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/hm-types.ts', 'src/vault.ts', 'src/os-keychain.ts', 'src/vault-local.ts'],
  format: ['esm'],
  dts: false,
  splitting: true,
  clean: true,
  external: ['zod'],
})

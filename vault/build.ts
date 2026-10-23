import {copyFile, rm} from 'node:fs/promises'
import tailwind from 'bun-plugin-tailwind'
import uglify from './uglify-js'
import {reactSingletonPlugin} from './react-singleton-plugin'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import process from 'node:process'

const OUTDIR = './dist'

// Ensure this script runs from the directory where it lives.
process.chdir(path.dirname(fileURLToPath(import.meta.url)))

await rm(OUTDIR, {recursive: true, force: true})

const result = await Bun.build({
  entrypoints: ['./src/main.ts'],
  outdir: OUTDIR,
  target: 'bun',
  splitting: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: 'linked',
  naming: {
    chunk: 'chunks/[name].[hash].[ext]',
    asset: '[dir]/[name].[hash].[ext]',
  },
  publicPath: '/vault/',
  root: './src',
  plugins: [reactSingletonPlugin, tailwind, uglify],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

await copyFile('../frontend/packages/ui/THIRD_PARTY_NOTICES.md', `${OUTDIR}/THIRD_PARTY_NOTICES.md`)

console.log('Build succeeded!')
for (const output of result.outputs) {
  console.log(`  ${output.path}`)
}

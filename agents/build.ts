import {rm} from 'node:fs/promises'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import process from 'node:process'

const OUTDIR = './dist'

// Ensure this script runs from the directory where it lives.
process.chdir(path.dirname(fileURLToPath(import.meta.url)))

await rm(OUTDIR, {recursive: true, force: true})

const result = await Bun.build({
  entrypoints: ['./src/main.ts', './src/workflow-worker-entry.ts', './src/voice-worker.ts'],
  outdir: OUTDIR,
  target: 'bun',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: 'linked',
  naming: {
    chunk: '[dir]/[name].[hash].[ext]',
    asset: '[dir]/[name].[hash].[ext]',
  },
  root: './src',
  // Bundling `microsandbox` breaks it: its napi binding, `msb` hypervisor helper, and libkrunfw
  // cannot live inside bundled JS, so the bundle dies at execute time with "Cannot find module
  // '../../native/index.cjs'". Kept external; the Dockerfile stages the package into
  // node_modules/ next to dist/ the same way build-binary.ts stages it next to the binary.
  // `canvas` is an optional native dep reached only through linkedom's guarded require — its
  // fallback shim covers us — and bundling it fails on machines where the binding never compiled.
  // The LiveKit agents framework and its plugins (voice-worker.js) stay external for the same
  // reason: they reach native code (`@livekit/rtc-node` ffi bindings, `onnxruntime-node` for the
  // Silero VAD and turn detector, `@livekit/av`) through per-platform packages and fork their own
  // job/inference child processes from files inside the package. scripts/stage-msb-runtime.ts
  // stages their dependency closure into the image's node_modules.
  external: [
    'microsandbox',
    'canvas',
    '@livekit/agents',
    '@livekit/agents-plugin-deepgram',
    '@livekit/agents-plugin-cartesia',
    '@livekit/agents-plugin-silero',
    '@livekit/agents-plugin-livekit',
    '@livekit/rtc-node',
    'onnxruntime-node',
  ],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build succeeded!')
for (const output of result.outputs) {
  console.log(`  ${output.path}`)
}

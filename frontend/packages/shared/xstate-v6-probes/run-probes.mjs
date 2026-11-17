#!/usr/bin/env node
// Type-safety defect probes: compile each probes/<version>/p<N>.ts in isolation
// with tsconfig.probes.json's strict options and report which defects each
// XState major version catches at compile time.
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const tscPath = require.resolve('typescript/bin/tsc')
const baseConfig = JSON.parse(readFileSync(join(here, 'tsconfig.probes.json'), 'utf8'))

const ids = Array.from({length: 10}, (_, i) => `p${i}`)
const versions = ['v5', 'v6']

const report = []
const tmp = mkdtempSync(join(tmpdir(), 'xstate-v6-probes-'))

for (const version of versions) {
  for (const id of ids) {
    const file = join(here, 'probes', version, `${id}.ts`)
    const cfgPath = join(tmp, `${version}-${id}.json`)
    writeFileSync(
      cfgPath,
      JSON.stringify({
        compilerOptions: baseConfig.compilerOptions,
        files: [file],
      }),
    )
    const run = spawnSync(process.execPath, [tscPath, '--noEmit', '-p', cfgPath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    const errors = [...output.matchAll(/error TS(\d+):\s*(.*)/g)]
    report.push({
      id,
      version,
      file: `probes/${version}/${id}.ts`,
      exitCode: run.status,
      errorCount: errors.length,
      firstErrorCode: errors[0] ? `TS${errors[0][1]}` : null,
      firstErrorMessage: errors[0] ? errors[0][2].trim() : null,
      errors: errors.map((e) => ({code: `TS${e[1]}`, message: e[2].trim()})),
    })
  }
}

const outDir = '/tmp/xstate-v6-evidence'
mkdirSync(outDir, {recursive: true})
const outPath = join(outDir, 'probes.json')
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
console.log(`\nwrote ${outPath}`)

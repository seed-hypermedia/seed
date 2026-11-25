#!/usr/bin/env node
/**
 * Interleaved A/B comparison of server builds with bench.mjs.
 *
 *   node scripts/ssr-bench/ab.mjs --builds base=path/to/a/server/index.js,new=path/to/b/server/index.js \
 *     [--rounds 3] [--iterations 30] [--warmup 5] [--daemon http://localhost:58999] [--out ab.json]
 *
 * Runs every build once per round, alternating, each in a fresh process (server
 * logs discarded), so drift in machine load lands on all builds alike. Reports,
 * per page and build, the median over rounds of the per-run median CPU ms per
 * request, with the min-max of the per-run medians as the spread.
 */
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? dflt : args[i + 1]
}
const builds = opt('builds', '')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [name, path] = s.split('=')
    return {name, path}
  })
const rounds = Number(opt('rounds', '3'))
const passThrough = ['iterations', 'warmup', 'daemon', 'pages'].flatMap((k) => (opt(k) ? [`--${k}`, opt(k)] : []))
const tmp = mkdtempSync(join(tmpdir(), 'ssr-ab-'))

/** results[build][page][metric] = per-run medians */
const results = {}
for (let round = 0; round < rounds; round++) {
  for (const build of builds) {
    const out = join(tmp, `${build.name}-${round}.json`)
    const run = spawnSync(
      process.execPath,
      [join(here, 'bench.mjs'), '--build', build.path, '--out', out, ...passThrough],
      {stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'},
    )
    if (run.status !== 0) {
      console.error(run.stderr)
      process.exit(1)
    }
    const total = run.stderr.split('\n').find((l) => l.startsWith('TOTAL'))
    console.error(`round ${round + 1} ${build.name.padEnd(8)} ${total?.replace(/^TOTAL \(sum of medians\)\s*/, '')}`)
    for (const r of JSON.parse(readFileSync(out, 'utf8')).results) {
      const page = ((results[build.name] ??= {})[r.name] ??= {cpuMs: [], mainThreadMs: [], gcMs: [], bytes: r.bytes})
      page.cpuMs.push(r.cpuMs.median)
      page.mainThreadMs.push(r.mainThreadMs.median)
      page.gcMs.push(r.gcMs.median)
    }
  }
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)]
const summary = {}
const pages = Object.keys(results[builds[0].name])
const header = ['page'.padEnd(20), ...builds.map((b) => `${b.name} cpu ms [min-max]`.padEnd(30))]
if (builds.length === 2) header.push('change')
console.log(header.join(''))
const totals = Object.fromEntries(builds.map((b) => [b.name, 0]))
for (const page of pages) {
  const cells = [page.padEnd(20)]
  for (const b of builds) {
    const p = results[b.name][page]
    const m = median(p.cpuMs)
    totals[b.name] += m
    ;(summary[b.name] ??= {})[page] = {
      cpuMs: m,
      cpuMsMin: Math.min(...p.cpuMs),
      cpuMsMax: Math.max(...p.cpuMs),
      mainThreadMs: median(p.mainThreadMs),
      gcMs: median(p.gcMs),
      bytes: p.bytes,
    }
    cells.push(`${m.toFixed(1)} [${Math.min(...p.cpuMs).toFixed(1)}-${Math.max(...p.cpuMs).toFixed(1)}]`.padEnd(30))
  }
  if (builds.length === 2) {
    const [a, b] = builds.map((x) => summary[x.name][page].cpuMs)
    cells.push(`${(((b - a) / a) * 100).toFixed(1)}%`)
  }
  console.log(cells.join(''))
}
const totalCells = ['TOTAL'.padEnd(20), ...builds.map((b) => totals[b.name].toFixed(1).padEnd(30))]
if (builds.length === 2) {
  const [a, b] = builds.map((x) => totals[x.name])
  totalCells.push(`${(((b - a) / a) * 100).toFixed(1)}%`)
}
console.log(totalCells.join(''))
const outFile = opt('out')
if (outFile) writeFileSync(outFile, JSON.stringify({rounds, results, summary}, null, 2))

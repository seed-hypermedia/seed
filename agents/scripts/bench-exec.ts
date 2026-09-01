/**
 * Measures execute_code sandbox latency on this host: boot, run, and teardown per execution,
 * through the exact same executor the agents server uses. This is the probe behind the warm-pool
 * workstream in docs/exec-warm-pool.md — run it before and after to prove the boot cost moved.
 *
 * Usage: bun scripts/bench-exec.ts [--runs=5] [--runtime=shell|python|ts]
 *
 * Requires a host that can run microVMs (see /api/health codeExec on a running server). Results
 * print per-run and aggregate milliseconds; the memory workspace is a throwaway temp directory.
 */
import {createCodeExecutor, defaultCodeExecConfig, type CodeExecRuntime} from '@/code-exec'
import {perfSnapshot} from '@/perf'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = '', value = ''] = arg.replace(/^--/, '').split('=', 2)
    return [key, value] as const
  }),
)
const runCount = Math.max(1, Number(args.get('runs') ?? 5))
const runtime = (args.get('runtime') ?? 'shell') as CodeExecRuntime

const code = runtime === 'python' ? 'print("bench")' : runtime === 'ts' ? 'console.log("bench")' : 'echo bench'

// realpath because macOS tmpdir lives under a symlink (/var → /private/var) the bind mount rejects.
const stateDir = await realpath(await mkdtemp(path.join(tmpdir(), 'seed-bench-exec-')))
const executor = createCodeExecutor(defaultCodeExecConfig())

const availability = await executor.availability()
if (!availability.available) {
  console.error(`Code execution unavailable here: ${availability.reason} (${availability.code})`)
  process.exit(1)
}

console.log(`Benchmarking ${runCount} ${runtime} executions (fresh microVM each, current behavior)…`)
const rows: Array<{run: number; bootMs: number; totalMs: number; exitCode: number}> = []
try {
  for (let index = 1; index <= runCount; index += 1) {
    const result = await executor.execute({stateDir, runtime, code})
    rows.push({run: index, bootMs: result.bootMs, totalMs: result.durationMs, exitCode: result.exitCode})
    console.log(
      `  run ${index}: boot ${result.bootMs}ms, total ${result.durationMs}ms, ` +
        `run ${result.durationMs - result.bootMs}ms, exit ${result.exitCode}`,
    )
  }
} finally {
  await rm(stateDir, {recursive: true, force: true})
}

const boots = rows.map((row) => row.bootMs).sort((a, b) => a - b)
const totals = rows.map((row) => row.totalMs).sort((a, b) => a - b)
const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)] ?? 0
console.log(`\nboot:  median ${median(boots)}ms, min ${boots[0]}ms, max ${boots.at(-1)}ms`)
console.log(`total: median ${median(totals)}ms, min ${totals[0]}ms, max ${totals.at(-1)}ms`)
console.log(`boot share of total (median run): ${Math.round((median(boots) / Math.max(1, median(totals))) * 100)}%`)
console.log('\nperf snapshot (same aggregates the server serves at /api/perf):')
console.log(JSON.stringify(perfSnapshot().metrics, null, 2))

/**
 * Real-guest verification of the warm pool's reset-before-park contract: no process from a
 * previous call is RUNNING when the VM is reused (docs/exec-warm-pool.md, seam contract item 4).
 *
 * The unit tests exercise the pool against fakes; only a live microVM can prove the guest-side
 * sweep. Each scenario plants leftovers in call 1 — and call 1 ASSERTS the plant took (prints
 * PLANTED-OK only after verifying its daemon is alive), so a scenario can never pass vacuously.
 * Release runs the reset; call 2 autopsies the process table by marker. Expectations are
 * per-scenario, per ion's staging review:
 *
 * - `reuse-clean` (plain daemon, double-forked orphan): the reset MUST converge — the VM is
 *   reused (bootMs 0) AND no marked process is alive. A disposal here is a FAIL: it would mean
 *   the sweep cannot even clean a single idle daemon.
 * - `clean` (moderate respawner): either outcome is acceptable — reuse or disposal — but the VM
 *   serving call 2 must be clean; the outcome taken is reported.
 * - `expect-disposal` (recursive fork storm): the bounded sweep is SUPPOSED to give up here —
 *   pass-budget exhaustion must dispose the VM (fresh boot in call 2) and call 2 must be clean.
 *   This proves the fail-closed path, not just the happy path. Retried a few times because a
 *   fast host can occasionally out-race the storm.
 *
 * Detection is by a marker assembled at runtime in call 2, so the autopsy shell's own cmdline
 * (which carries this script's text) can never match itself — a literal marker produced false
 * ALIVE reports when this harness was first built. Zombies (State: Z) are corpses, not survivors.
 *
 * Usage: bun scripts/verify-exec-reset.ts   (needs a microVM-capable host)
 */
import {createCodeExecutor, defaultCodeExecConfig} from '@/code-exec'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'

const MARKER = '31337'

type Expectation = 'reuse-clean' | 'clean' | 'expect-disposal'

const SCENARIOS: Array<{name: string; plant: string; expect: Expectation; retries?: number}> = [
  {
    name: 'plain background daemon',
    expect: 'reuse-clean',
    plant: [
      `nohup sleep ${MARKER} >/dev/null 2>&1 &`,
      'pid=$!',
      'sleep 0.2',
      'kill -0 "$pid" 2>/dev/null && echo PLANTED-OK || echo PLANT-FAILED',
    ].join('\n'),
  },
  {
    name: 'double-forked (orphaned) daemon',
    expect: 'reuse-clean',
    plant: [
      `(nohup sh -c "sleep ${MARKER}" >/dev/null 2>&1 &)`,
      'sleep 0.3',
      // No $! across the double fork: verify by marker, excluding this shell itself.
      `M=${MARKER.slice(0, 3)}; M="\${M}${MARKER.slice(3)}"`,
      'found=0',
      'for f in /proc/[0-9]*/cmdline; do',
      '  pid=${f%/cmdline}; pid=${pid#/proc/}',
      '  [ "$pid" = "$$" ] && continue',
      '  tr "\\0" " " < "$f" 2>/dev/null | grep -q "$M" && found=1',
      'done',
      '[ "$found" -eq 1 ] && echo PLANTED-OK || echo PLANT-FAILED',
    ].join('\n'),
  },
  {
    name: 'moderate respawner',
    expect: 'clean',
    plant: [
      `nohup sh -c 'while true; do sleep ${MARKER} & sleep 0.2; done' >/dev/null 2>&1 &`,
      'pid=$!',
      'sleep 0.3',
      'kill -0 "$pid" 2>/dev/null && echo PLANTED-OK || echo PLANT-FAILED',
    ].join('\n'),
  },
  {
    name: 'recursive fork storm',
    expect: 'expect-disposal',
    retries: 3,
    plant: [
      // Every child is itself a forker, so killing any one parent never dries the tree — the
      // bounded sweep must exhaust its passes and dispose the VM.
      `nohup sh -c 'f(){ while true; do f & sleep 0.01; done; }; f' >/dev/null 2>&1 &`,
      'pid=$!',
      'sleep 0.3',
      'kill -0 "$pid" 2>/dev/null && echo PLANTED-OK || echo PLANT-FAILED',
    ].join('\n'),
  },
]

const AUTOPSY = [
  `M=${MARKER.slice(0, 3)}`,
  `M="\${M}${MARKER.slice(3)}"`,
  'alive=0',
  'for f in /proc/[0-9]*/cmdline; do',
  '  pid=${f%/cmdline}; pid=${pid#/proc/}',
  '  [ "$pid" = "$$" ] && continue',
  '  if tr "\\0" " " < "$f" 2>/dev/null | grep -q "$M"; then',
  '    state=$(grep "^State:" /proc/$pid/status 2>/dev/null | cut -f2 | cut -c1)',
  '    if [ "$state" != "Z" ]; then alive=$((alive+1)); echo "ALIVE: pid $pid state $state"; fi',
  '  fi',
  'done',
  'echo "alive marked processes: $alive"',
].join('\n')

const stateDir = await realpath(await mkdtemp(path.join(tmpdir(), 'seed-verify-reset-')))
const executor = createCodeExecutor({...defaultCodeExecConfig(), warmPool: true})
const availability = await executor.availability()
if (!availability.available) {
  console.error(`Code execution unavailable here: ${availability.reason} (${availability.code})`)
  process.exit(1)
}

type Attempt = {planted: boolean; reused: boolean; clean: boolean; bootMs: number}

async function runScenario(scenario: (typeof SCENARIOS)[number], attempt: number): Promise<Attempt> {
  // A distinct principal per attempt so a disposed VM from a prior attempt cannot interfere.
  const principal = {accountId: 'verify-reset', agentId: `${scenario.name.replace(/\W+/g, '-')}-${attempt}`}
  const plant = await executor.execute({principal, stateDir, runtime: 'shell', code: scenario.plant})
  const planted = /PLANTED-OK/.test(plant.stdout)
  const autopsy = await executor.execute({principal, stateDir, runtime: 'shell', code: AUTOPSY})
  return {
    planted,
    reused: autopsy.bootMs === 0,
    clean: /alive marked processes: 0/.test(autopsy.stdout),
    bootMs: autopsy.bootMs,
  }
}

let failures = 0
try {
  for (const scenario of SCENARIOS) {
    const retries = scenario.retries ?? 1
    let outcome: Attempt | undefined
    let verdict = ''
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      outcome = await runScenario(scenario, attempt)
      if (!outcome.planted) {
        verdict = 'FAIL (plant did not take — scenario proves nothing)'
        break
      }
      if (!outcome.clean) {
        verdict = 'FAIL (a prior-call process was running in call 2)'
        break
      }
      if (scenario.expect === 'reuse-clean') {
        verdict = outcome.reused
          ? 'PASS (reused clean VM)'
          : 'FAIL (reset disposed the VM for a trivially cleanable guest)'
        break
      }
      if (scenario.expect === 'clean') {
        verdict = `PASS (clean; ${outcome.reused ? 'reused' : 'disposed + fresh boot'})`
        break
      }
      // expect-disposal: keep retrying while the sweep out-races the storm.
      if (!outcome.reused) {
        verdict = 'PASS (pass budget exhausted; VM disposed, fresh boot clean)'
        break
      }
      verdict = 'FAIL (storm never forced disposal — strengthen the storm or the host is too fast)'
    }
    if (verdict.startsWith('FAIL')) failures += 1
    console.log(`${scenario.name}: ${verdict}`)
    if (outcome) console.log(`  planted=${outcome.planted} call2 bootMs=${outcome.bootMs} clean=${outcome.clean}`)
  }
} finally {
  await executor.drain()
  await rm(stateDir, {recursive: true, force: true})
}
if (failures > 0) {
  console.error(`\n${failures} scenario(s) failed — the reset contract is not established.`)
  process.exit(1)
}
console.log('\nAll scenarios established their expectation: verified empty on reuse, disposal when unresettable.')

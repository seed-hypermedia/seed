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
import {perfSnapshot} from '@/perf'
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
    name: 'self-perpetuating respawn chain',
    expect: 'expect-disposal',
    retries: 3,
    plant: [
      // Each generation forks its successor FIRST, then parks in a long sleep. Every sweep pass
      // sees at least one live generation (dirty) while the just-forked successor postdates that
      // pass's /proc snapshot — so the chain survives every pass and the bounded reset must
      // exhaust its budget. Gentle by construction (~50 tiny sleeps/sec, no doubling), unlike a
      // raw fork bomb, which melts the guest so hard the PLANT call itself dies and the disposal
      // gets attributed to an unhealthy release instead of the reset.
      `nohup sh -c 'r(){ (sleep 0.02; r) & sleep ${MARKER}; }; r' >/dev/null 2>&1 &`,
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

type Attempt = {
  planted: boolean
  reused: boolean
  clean: boolean
  bootMs: number
  /* Counter deltas across the scenario, attributing WHY the pool behaved as it did. */
  resetFailed: number
  poolHit: number
}

const counterValue = (name: string): number => perfSnapshot().counters[name]?.count ?? 0

async function runScenario(scenario: (typeof SCENARIOS)[number], attempt: number): Promise<Attempt> {
  // A distinct principal per attempt so a disposed VM from a prior attempt cannot interfere.
  const principal = {accountId: 'verify-reset', agentId: `${scenario.name.replace(/\W+/g, '-')}-${attempt}`}
  const resetFailedBefore = counterValue('exec.pool_reset_failed')
  const poolHitBefore = counterValue('exec.pool_hit')
  const plant = await executor.execute({principal, stateDir, runtime: 'shell', code: scenario.plant})
  // Positive call-1 success: the plant must have executed cleanly AND verified its daemon alive —
  // a timed-out or failed planting call must never let a scenario "pass" vacuously.
  const planted = plant.exitCode === 0 && /PLANTED-OK/.test(plant.stdout)
  const autopsy = await executor.execute({principal, stateDir, runtime: 'shell', code: AUTOPSY})
  return {
    planted,
    reused: autopsy.bootMs === 0,
    clean: autopsy.exitCode === 0 && /alive marked processes: 0/.test(autopsy.stdout),
    bootMs: autopsy.bootMs,
    resetFailed: counterValue('exec.pool_reset_failed') - resetFailedBefore,
    poolHit: counterValue('exec.pool_hit') - poolHitBefore,
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
        if (outcome.reused && outcome.poolHit === 1 && outcome.resetFailed === 0) {
          verdict = 'PASS (pool hit, reused clean VM, reset succeeded)'
        } else if (!outcome.reused) {
          verdict = 'FAIL (reset disposed the VM for a trivially cleanable guest)'
        } else {
          verdict = `FAIL (reuse not attributable to a clean pool hit: poolHit=${outcome.poolHit} resetFailed=${outcome.resetFailed})`
        }
        break
      }
      if (scenario.expect === 'clean') {
        if (outcome.reused) verdict = 'PASS (clean; reused via pool hit)'
        else if (outcome.resetFailed >= 1) verdict = 'PASS (clean; reset-caused disposal + fresh boot)'
        else verdict = 'FAIL (disposed clean, but not attributable to the reset — investigate the disposal path)'
        break
      }
      // expect-disposal: the fresh boot must be POSITIVELY attributed to reset-budget exhaustion —
      // exactly one pool_reset_failed during the scenario — not to a failed probe, a timed-out
      // plant, or any other disposal path that looks identical from boot timing alone.
      if (!outcome.reused && outcome.resetFailed === 1) {
        verdict = 'PASS (reset pass budget exhausted; reset-attributed disposal, fresh boot clean)'
        break
      }
      if (!outcome.reused) {
        verdict = `FAIL (disposal happened but was not reset-attributed: resetFailed=${outcome.resetFailed})`
        break
      }
      verdict = 'FAIL (storm never forced disposal — strengthen the storm or the host is too fast)'
    }
    if (verdict.startsWith('FAIL')) failures += 1
    console.log(`${scenario.name}: ${verdict}`)
    if (outcome) {
      console.log(
        `  planted=${outcome.planted} call2 bootMs=${outcome.bootMs} clean=${outcome.clean} ` +
          `poolHit=${outcome.poolHit} resetFailed=${outcome.resetFailed}`,
      )
    }
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

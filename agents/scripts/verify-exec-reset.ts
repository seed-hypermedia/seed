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
 * - `expect-disposal` (self-perpetuating respawn chains): the bounded sweep is SUPPOSED to give
 *   up here — call 1's release reset must exhaust its pass budget (exactly one
 *   `exec.pool_reset_exhausted` in the call-1 counter window, none anywhere else) and call 2 must
 *   be a clean fresh boot. This proves the fail-closed path with positive attribution, not just
 *   the happy path. Probabilistic by nature — a pass can catch every pending chain tip
 *   pre-recursion — so the harness retries and reports a converged attempt rather than passing it.
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
    name: 'self-perpetuating respawn chains',
    expect: 'expect-disposal',
    retries: 3,
    plant: [
      // Three independent staggered chains; each generation forks its successor FIRST, then parks
      // in a long sleep, so a sweep pass that sees a generation (dirty, killed) usually postdates
      // the fork of its successor. NOT deterministic: a pass whose snapshot happens to catch
      // every pending tip pre-recursion kills all chains and the reset converges — three tips
      // with staggered phases make that unlikely, and the harness retries; a converged attempt is
      // reported, never silently passed. Gentle by construction (~150 tiny sleeps/sec, no
      // doubling) — a raw fork bomb melts the guest so hard the PLANT call itself dies and the
      // disposal gets attributed to an unhealthy release instead of the reset.
      `for stagger in 0 0.007 0.013; do`,
      `  nohup sh -c "sleep $stagger; r(){ (sleep 0.02; r) & sleep ${MARKER}; }; r" >/dev/null 2>&1 &`,
      'done',
      'pid=$!',
      'sleep 0.4',
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

type CounterWindow = {resetExhausted: number; resetError: number; probeFailed: number; poolHit: number}

type Attempt = {
  planted: boolean
  reused: boolean
  clean: boolean
  bootMs: number
  /** Counter deltas measured across call 1 (plant + its release reset) and call 2 separately. */
  call1: CounterWindow
  call2: CounterWindow
}

const COUNTERS: Record<keyof CounterWindow, string> = {
  resetExhausted: 'exec.pool_reset_exhausted',
  resetError: 'exec.pool_reset_error',
  probeFailed: 'exec.pool_probe_failed',
  poolHit: 'exec.pool_hit',
}

function counterSample(): CounterWindow {
  const counters = perfSnapshot().counters
  const value = (name: string): number => counters[name]?.count ?? 0
  return {
    resetExhausted: value(COUNTERS.resetExhausted),
    resetError: value(COUNTERS.resetError),
    probeFailed: value(COUNTERS.probeFailed),
    poolHit: value(COUNTERS.poolHit),
  }
}

function windowDelta(before: CounterWindow, after: CounterWindow): CounterWindow {
  return {
    resetExhausted: after.resetExhausted - before.resetExhausted,
    resetError: after.resetError - before.resetError,
    probeFailed: after.probeFailed - before.probeFailed,
    poolHit: after.poolHit - before.poolHit,
  }
}

const noDisposals = (w: CounterWindow): boolean => w.resetExhausted === 0 && w.resetError === 0 && w.probeFailed === 0

async function runScenario(scenario: (typeof SCENARIOS)[number], attempt: number): Promise<Attempt> {
  // A distinct principal per attempt so a disposed VM from a prior attempt cannot interfere.
  const principal = {accountId: 'verify-reset', agentId: `${scenario.name.replace(/\W+/g, '-')}-${attempt}`}
  // Counters are sampled around EACH call: the plant call's release runs inside execute(), so the
  // call-1 window isolates the reset under test, and the call-2 window proves the autopsy's own
  // acquire/release contributed no disposal that could be misattributed to call 1.
  const beforePlant = counterSample()
  const plant = await executor.execute({principal, stateDir, runtime: 'shell', code: scenario.plant})
  const afterPlant = counterSample()
  // Positive call-1 success: the plant must have executed cleanly AND verified its daemon alive —
  // a timed-out or failed planting call must never let a scenario "pass" vacuously.
  const planted = plant.exitCode === 0 && /PLANTED-OK/.test(plant.stdout)
  const autopsy = await executor.execute({principal, stateDir, runtime: 'shell', code: AUTOPSY})
  const afterAutopsy = counterSample()
  return {
    planted,
    reused: autopsy.bootMs === 0,
    clean: autopsy.exitCode === 0 && /alive marked processes: 0/.test(autopsy.stdout),
    bootMs: autopsy.bootMs,
    call1: windowDelta(beforePlant, afterPlant),
    call2: windowDelta(afterPlant, afterAutopsy),
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
        if (outcome.reused && outcome.call2.poolHit === 1 && noDisposals(outcome.call1) && noDisposals(outcome.call2)) {
          verdict = 'PASS (call-1 reset succeeded; call-2 pool hit, reused clean VM)'
        } else if (!outcome.reused) {
          verdict = 'FAIL (reset disposed the VM for a trivially cleanable guest)'
        } else {
          verdict = `FAIL (reuse not attributable to a clean pool hit: call1=${JSON.stringify(
            outcome.call1,
          )} call2=${JSON.stringify(outcome.call2)})`
        }
        break
      }
      if (scenario.expect === 'clean') {
        if (outcome.reused && outcome.call2.poolHit === 1) verdict = 'PASS (clean; reused via pool hit)'
        else if (!outcome.reused && outcome.call1.resetExhausted >= 1)
          verdict = 'PASS (clean; call-1 reset-exhausted disposal + fresh boot)'
        else
          verdict = `FAIL (outcome not attributable: call1=${JSON.stringify(outcome.call1)} call2=${JSON.stringify(
            outcome.call2,
          )})`
        break
      }
      // expect-disposal: the fresh boot must be POSITIVELY attributed to CALL 1's release reset
      // exhausting its pass budget — exactly one pool_reset_exhausted inside the call-1 window,
      // zero disposal counters in the call-2 window (so the autopsy's own probe/reset cannot be
      // the source), and no transport-error masquerading (resetError 0).
      if (
        !outcome.reused &&
        outcome.call1.resetExhausted === 1 &&
        outcome.call1.resetError === 0 &&
        noDisposals(outcome.call2)
      ) {
        verdict = 'PASS (call-1 reset pass budget exhausted; attributed disposal, fresh boot clean)'
        break
      }
      if (!outcome.reused) {
        verdict = `FAIL (disposal not attributable to call-1 reset exhaustion: call1=${JSON.stringify(
          outcome.call1,
        )} call2=${JSON.stringify(outcome.call2)})`
        break
      }
      verdict = 'FAIL (storm never forced disposal — strengthen the storm or the host is too fast)'
    }
    if (verdict.startsWith('FAIL')) failures += 1
    console.log(`${scenario.name}: ${verdict}`)
    if (outcome) {
      console.log(
        `  planted=${outcome.planted} call2 bootMs=${outcome.bootMs} clean=${outcome.clean}\n` +
          `  call1 deltas=${JSON.stringify(outcome.call1)}\n  call2 deltas=${JSON.stringify(outcome.call2)}`,
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

/**
 * Real-guest verification of the warm pool's reset-before-park contract: no process from a
 * previous call is RUNNING when the VM is reused (docs/exec-warm-pool.md, seam contract item 4).
 *
 * The unit tests exercise the pool against fakes; only a live microVM can prove the guest-side
 * sweep. Each scenario plants leftovers in call 1 — including a continuously-respawning forker,
 * the shape of the fork-during-sweep race — releases (which runs the reset), then autopsies the
 * process table in call 2. Detection is by marker (the distinctive sleep durations below), so the
 * check cannot false-positive on call 2's own processes; zombies (State: Z) are corpses, not
 * survivors. A run passes when the VM was reused (bootMs 0 — reset reported clean) AND no marked
 * process is alive; a reset that instead disposed the VM (fresh boot in call 2) is reported as
 * such — contract-compliant, but worth eyes.
 *
 * Usage: bun scripts/verify-exec-reset.ts   (needs a microVM-capable host)
 */
import {createCodeExecutor, defaultCodeExecConfig} from '@/code-exec'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'

const MARKER = '31337'

const SCENARIOS: Array<{name: string; plant: string}> = [
  {
    name: 'plain background daemon',
    plant: `nohup sleep ${MARKER} >/dev/null 2>&1 & sleep 0.2; echo planted`,
  },
  {
    name: 'continuously respawning forker',
    plant: `nohup sh -c 'while true; do sleep ${MARKER} & sleep 0.02; done' >/dev/null 2>&1 & sleep 0.3; echo planted`,
  },
  {
    name: 'double-forked (orphaned) daemon',
    plant: `(nohup sh -c "sleep ${MARKER}" >/dev/null 2>&1 &) ; sleep 0.2; echo planted`,
  },
]

// The marker is assembled at runtime so the autopsy shell's own cmdline (which carries this
// script's text) can never match it — a literal marker in the grep pattern makes the autopsy
// find itself and report a false ALIVE (learned the hard way against a real guest).
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

let failures = 0
try {
  for (const scenario of SCENARIOS) {
    const principal = {accountId: 'verify-reset', agentId: scenario.name.replace(/\W+/g, '-')}
    const plant = await executor.execute({principal, stateDir, runtime: 'shell', code: scenario.plant})
    const autopsy = await executor.execute({principal, stateDir, runtime: 'shell', code: AUTOPSY})
    const reused = autopsy.bootMs === 0
    const clean = /alive marked processes: 0/.test(autopsy.stdout)
    const verdict = clean ? (reused ? 'PASS (reused clean VM)' : 'PASS (reset disposed the VM; fresh boot)') : 'FAIL'
    if (!clean) failures += 1
    console.log(`${scenario.name}: ${verdict}`)
    console.log(`  call1 exit ${plant.exitCode}; call2 bootMs ${autopsy.bootMs}`)
    console.log(`  ${autopsy.stdout.trim().split('\n').join('\n  ')}`)
  }
} finally {
  await executor.drain()
  await rm(stateDir, {recursive: true, force: true})
}
if (failures > 0) {
  console.error(`\n${failures} scenario(s) left a prior-call process running — the reset contract is broken.`)
  process.exit(1)
}
console.log('\nAll scenarios clean: no prior-call process was running at reuse.')

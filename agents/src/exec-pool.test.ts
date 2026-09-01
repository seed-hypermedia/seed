/**
 * Warm-pool contract tests (docs/exec-warm-pool.md, "Seam contract"): principal-key isolation,
 * same-key serialization, reset-before-park, lifetime independent of call timeout, and
 * unhealthy-release eviction/drain — the exact list ion's review gated the pool on.
 */
import {describe, expect, test, beforeEach} from 'bun:test'
import {
  createCodeExecutor,
  createWarmPoolSource,
  defaultCodeExecConfig,
  type CodeExecConfig,
  type SandboxLike,
  type SandboxSdk,
  type SandboxSpec,
} from '@/code-exec'
import {perfSnapshot, resetPerfForTests} from '@/perf'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type GuestSandbox = SandboxLike & {
  id: number
  execScripts: string[]
  stopped: boolean
  killed: boolean
}

type GuestFarm = {
  sdk: SandboxSdk
  sandboxes: GuestSandbox[]
  /** When set, guest shell execs (reset/probe) report failure. */
  failGuestExec: boolean
  /** When set, stop() resolves only after this many milliseconds. */
  stopDelayMs: number
}

/** Fake SDK whose every create() yields a fresh guest that records its execs and teardown. */
function guestFarm(): GuestFarm {
  const farm: GuestFarm = {sandboxes: [], failGuestExec: false, stopDelayMs: 0, sdk: undefined as never}
  const optionsBuilder = {args: () => optionsBuilder, timeout: () => optionsBuilder} as never
  farm.sdk = {
    Sandbox: {
      builder() {
        const chain: Record<string, unknown> = {}
        for (const method of [
          'image',
          'cpus',
          'memory',
          'workdir',
          'ephemeral',
          'security',
          'maxDuration',
          'volume',
          'network',
          'disableNetwork',
        ]) {
          chain[method] = () => chain
        }
        chain.create = async (): Promise<GuestSandbox> => {
          const sandbox: GuestSandbox = {
            id: farm.sandboxes.length,
            execScripts: [],
            stopped: false,
            killed: false,
            async execWith(cmd, configure) {
              configure(optionsBuilder)
              if (cmd === '/bin/sh') sandbox.execScripts.push('guest-shell')
              if (farm.failGuestExec) return {code: 1, success: false, stdout: () => '', stderr: () => 'wedged'}
              return {code: 0, success: true, stdout: () => 'ok', stderr: () => ''}
            },
            async stop() {
              if (farm.stopDelayMs) await new Promise((resolve) => setTimeout(resolve, farm.stopDelayMs))
              sandbox.stopped = true
            },
            async kill() {
              sandbox.killed = true
            },
          }
          farm.sandboxes.push(sandbox)
          return sandbox
        }
        return chain as never
      },
    },
    NetworkPolicy: {fromProfiles: () => 'public'},
  }
  return farm
}

function poolConfig(overrides: Partial<CodeExecConfig> = {}): CodeExecConfig {
  return {
    ...defaultCodeExecConfig(),
    warmPool: true,
    poolMaxVms: 3,
    poolIdleTtlMs: 60_000,
    poolVmLifetimeMs: 60_000,
    teardownTimeoutMs: 200,
    timeoutGraceMs: 100,
    ...overrides,
  }
}

const specFor = (accountId: string, agentId: string, timeoutSecs = 1, sessionId = 'session-1'): SandboxSpec => ({
  principal: {accountId, agentId, sessionId},
  image: 'python',
  memoryRoot: '/tmp/unused-memory-root',
  timeoutSecs,
})

/** Waits until the farm records the expected teardown state (disposal is asynchronous). */
async function settled(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition never settled')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('warm pool source', () => {
  beforeEach(() => {
    resetPerfForTests()
  })

  test('same principal reuses the VM: no second boot, bootMs 0, reset on park, probe on reuse', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent'))
    expect(first.reused).toBe(false)
    expect(first.bootMs).toBeGreaterThanOrEqual(0)
    await first.release({healthy: true})
    // Reset-before-park ran in the guest.
    expect(farm.sandboxes[0]!.execScripts.length).toBe(1)
    const second = await source.acquire(specFor('acct', 'agent'))
    expect(second.reused).toBe(true)
    expect(second.bootMs).toBe(0)
    expect(second.sandbox).toBe(first.sandbox)
    expect(farm.sandboxes.length).toBe(1)
    // The reuse was gated on a health probe.
    expect(farm.sandboxes[0]!.execScripts.length).toBe(2)
    expect(perfSnapshot().counters['exec.pool_hit']!.count).toBe(1)
    expect(perfSnapshot().counters['exec.pool_miss']!.count).toBe(1)
  })

  test('SECURITY: different principals never receive the same VM', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const a = await source.acquire(specFor('acct-a', 'agent'))
    await a.release({healthy: true})
    // Same account, different agent — still a different principal.
    const b = await source.acquire(specFor('acct-a', 'agent-2'))
    expect(b.sandbox).not.toBe(a.sandbox)
    expect(b.reused).toBe(false)
    // Different account entirely.
    const c = await source.acquire(specFor('acct-b', 'agent'))
    expect(c.sandbox).not.toBe(a.sandbox)
    expect(c.sandbox).not.toBe(b.sandbox)
    // The parked VM of principal A is still there and still only reusable by A.
    await b.release({healthy: true})
    await c.release({healthy: true})
    const aAgain = await source.acquire(specFor('acct-a', 'agent'))
    expect(aAgain.sandbox).toBe(a.sandbox)
  })

  test('reuse is session-scoped: the same agent in a different session gets a fresh VM', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent', 1, 'session-1'))
    await first.release({healthy: true})
    // Same account, same agent — but a new conversation must start from a cold, known-clean VM.
    const second = await source.acquire(specFor('acct', 'agent', 1, 'session-2'))
    expect(second.sandbox).not.toBe(first.sandbox)
    expect(second.reused).toBe(false)
    await second.release({healthy: true})
    // The original session still reuses its own VM.
    const third = await source.acquire(specFor('acct', 'agent', 1, 'session-1'))
    expect(third.sandbox).toBe(first.sandbox)
    expect(third.reused).toBe(true)
  })

  test('a same-key acquire while the VM is leased gets a distinct single-use VM, never the leased one', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const held = await source.acquire(specFor('acct', 'agent'))
    const overflow = await source.acquire(specFor('acct', 'agent'))
    expect(overflow.sandbox).not.toBe(held.sandbox)
    expect(overflow.reused).toBe(false)
    expect(perfSnapshot().counters['exec.pool_overflow']!.count).toBe(1)
    // The overflow VM is disposed on release even when healthy; the pooled one parks.
    await overflow.release({healthy: true})
    await settled(() => (overflow.sandbox as GuestSandbox).stopped)
    await held.release({healthy: true})
    expect((held.sandbox as GuestSandbox).stopped).toBe(false)
    const next = await source.acquire(specFor('acct', 'agent'))
    expect(next.sandbox).toBe(held.sandbox)
  })

  test('an unhealthy release disposes the VM and the next acquire boots fresh', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent'))
    await first.release({healthy: false})
    await settled(() => farm.sandboxes[0]!.stopped)
    const second = await source.acquire(specFor('acct', 'agent'))
    expect(second.sandbox).not.toBe(first.sandbox)
    expect(second.reused).toBe(false)
  })

  test('a guest that fails its park reset is disposed, not reused, and the failure is counted', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent'))
    farm.failGuestExec = true
    await first.release({healthy: true})
    await settled(() => farm.sandboxes[0]!.stopped)
    // The counter is what lets an external observer attribute a disposal to the reset verdict.
    // The fake guest exits 1, which is the reset script's designated pass-budget-exhausted code.
    expect(perfSnapshot().counters['exec.pool_reset_exhausted']!.count).toBe(1)
    farm.failGuestExec = false
    const second = await source.acquire(specFor('acct', 'agent'))
    expect(second.sandbox).not.toBe(first.sandbox)
  })

  test('a parked VM that dies while idle fails its reuse probe and is replaced', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent'))
    await first.release({healthy: true})
    farm.failGuestExec = true
    const secondPromise = source.acquire(specFor('acct', 'agent'))
    farm.failGuestExec = false
    const second = await secondPromise
    expect(second.sandbox).not.toBe(first.sandbox)
    expect(second.reused).toBe(false)
    expect(perfSnapshot().counters['exec.pool_probe_failed']!.count).toBe(1)
  })

  test('VM lifetime is pool policy: a parked VM without enough life left is replaced, not reused', async () => {
    const farm = guestFarm()
    // Lifetime budget: 1s call timeout + 100ms grace must NOT fit into what remains after aging.
    const source = createWarmPoolSource(poolConfig({poolVmLifetimeMs: 1_300}), async () => farm.sdk)
    const first = await source.acquire(specFor('acct', 'agent', 1))
    await first.release({healthy: true})
    await new Promise((resolve) => setTimeout(resolve, 300))
    const second = await source.acquire(specFor('acct', 'agent', 1))
    expect(second.sandbox).not.toBe(first.sandbox)
    await settled(() => farm.sandboxes[0]!.stopped)
  })

  test('idle TTL disposes a parked VM', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig({poolIdleTtlMs: 30}), async () => farm.sdk)
    const lease = await source.acquire(specFor('acct', 'agent'))
    await lease.release({healthy: true})
    await settled(() => farm.sandboxes[0]!.stopped)
  })

  test('cap eviction disposes the least-recently parked idle VM', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig({poolMaxVms: 2}), async () => farm.sdk)
    const a = await source.acquire(specFor('acct-a', 'agent'))
    await a.release({healthy: true})
    const b = await source.acquire(specFor('acct-b', 'agent'))
    await b.release({healthy: true})
    const c = await source.acquire(specFor('acct-c', 'agent'))
    // A was parked first, so A's VM is the eviction victim.
    await settled(() => (a.sandbox as GuestSandbox).stopped)
    expect((b.sandbox as GuestSandbox).stopped).toBe(false)
    await c.release({healthy: true})
  })

  test('drain resolves only after asynchronous disposals finish', async () => {
    const farm = guestFarm()
    const source = createWarmPoolSource(poolConfig(), async () => farm.sdk)
    const lease = await source.acquire(specFor('acct', 'agent'))
    farm.stopDelayMs = 30
    await lease.release({healthy: false})
    expect(farm.sandboxes[0]!.stopped).toBe(false)
    await source.drain()
    expect(farm.sandboxes[0]!.stopped).toBe(true)
  })
})

describe('warm pool through the executor', () => {
  beforeEach(() => {
    resetPerfForTests()
  })

  test('config.warmPool routes executions through the pool: repeat calls reuse, principals isolate', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-pool-test-'))
    try {
      const farm = guestFarm()
      const executor = createCodeExecutor(poolConfig({poolVmLifetimeMs: 600_000}), async () => farm.sdk)
      const alpha = {accountId: 'acct', agentId: 'alpha', sessionId: 's1'}
      const first = await executor.execute({principal: alpha, stateDir, runtime: 'shell', code: 'echo hi'})
      const second = await executor.execute({principal: alpha, stateDir, runtime: 'shell', code: 'echo again'})
      expect(first.success).toBe(true)
      expect(second.bootMs).toBe(0)
      expect(farm.sandboxes.length).toBe(1)
      const beta = {accountId: 'acct', agentId: 'beta', sessionId: 's1'}
      await executor.execute({principal: beta, stateDir, runtime: 'shell', code: 'echo other'})
      expect(farm.sandboxes.length).toBe(2)
      expect(perfSnapshot().counters['exec.pool_hit']!.count).toBe(1)
      expect(perfSnapshot().counters['exec.pool_miss']!.count).toBe(2)
      await executor.drain()
    } finally {
      fs.rmSync(stateDir, {recursive: true, force: true})
    }
  })
})

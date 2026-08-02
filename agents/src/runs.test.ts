import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as sqlite from './sqlite.ts'
import * as runs from './runs.ts'

const ACCOUNT = 'acct-1'

function createDb(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('schema mismatch')
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, [ACCOUNT, now, now])
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['agent-1', ACCOUNT, new Uint8Array([160]), '/tmp/none', 'idle', now, now],
  )
  return db
}

function createSession(db: Database, sessionId: string): void {
  const now = Date.now()
  db.run(`INSERT INTO sessions (id, account_id, agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    sessionId,
    ACCOUNT,
    'agent-1',
    'idle',
    now,
    now,
  ])
}

function agentSpec(overrides: Partial<runs.EnqueueRunSpec> = {}): runs.EnqueueRunSpec {
  return {
    accountId: ACCOUNT,
    kind: 'agent',
    origin: 'user',
    agentId: 'agent-1',
    input: {},
    queue: 'background',
    ...overrides,
  }
}

async function untilTerminal(db: Database, runId: string, timeoutMs = 3_000): Promise<runs.RunRecord> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = runs.getRun(db, ACCOUNT, runId)
    if (run && runs.TERMINAL_RUN_STATUSES.includes(run.status)) return run
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not settle: ${run?.status}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function track(db: Database, queue: runs.RunQueue): void {
  cleanups.push(() => {
    queue.stop()
    db.close()
  })
}

describe('runs queue', () => {
  test('inline run succeeds with output, statuses, and finalize hook', async () => {
    const db = createDb()
    const changes: string[] = []
    const finalized: string[] = []
    const queue = new runs.RunQueue(db, {
      executors: {agent: async () => ({type: 'succeeded', output: {answer: 42}})},
      onRunChanged: (run) => changes.push(run.status),
      onRunFinalized: (run) => finalized.push(run.status),
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec({queue: 'interactive', dispatch: false}))
    expect(run.status).toBe('queued')
    const final = await queue.runInline(run.id)
    expect(final.status).toBe('succeeded')
    expect(final.output).toEqual({answer: 42})
    expect(final.startedAt).toBeGreaterThan(0)
    expect(final.finishedAt).toBeGreaterThan(0)
    expect(changes).toEqual(['queued', 'running', 'succeeded'])
    expect(finalized).toEqual(['succeeded'])
  })

  test('dispatch:false runs are not picked up by the loop', async () => {
    const db = createDb()
    const queue = new runs.RunQueue(db, {
      executors: {agent: async () => ({type: 'succeeded', output: null})},
      pollIntervalMs: 10,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec({dispatch: false}))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runs.getRun(db, ACCOUNT, run.id)?.status).toBe('queued')
  })

  test('background runs execute through the loop and awaitIdle observes completion', async () => {
    const db = createDb()
    const queue = new runs.RunQueue(db, {
      executors: {agent: async () => ({type: 'succeeded', output: 'done'})},
      pollIntervalMs: 10,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec())
    await queue.awaitIdle()
    expect(runs.getRun(db, ACCOUNT, run.id)?.status).toBe('succeeded')
  })

  test('retryable failure backs off and retries until success', async () => {
    const db = createDb()
    let attempts = 0
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async () => {
          attempts += 1
          if (attempts < 3) return {type: 'failed', error: {code: 'provider-error', message: 'boom', retryable: true}}
          return {type: 'succeeded', output: {attempts}}
        },
      },
      retryBaseMs: 5,
      pollIntervalMs: 5,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec({maxAttempts: 3}))
    const final = await untilTerminal(db, run.id)
    expect(final.status).toBe('succeeded')
    expect(final.attempt).toBe(3)
    expect(attempts).toBe(3)
  })

  test('terminal failure records the error without retrying', async () => {
    const db = createDb()
    let attempts = 0
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async () => {
          attempts += 1
          return {type: 'failed', error: {code: 'config-error', message: 'bad', retryable: false}}
        },
      },
      retryBaseMs: 5,
      pollIntervalMs: 5,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec({maxAttempts: 3}))
    const final = await untilTerminal(db, run.id)
    expect(final.status).toBe('failed')
    expect(final.error?.code).toBe('config-error')
    expect(attempts).toBe(1)
  })

  test('one live agent run per session: second run waits for the first', async () => {
    const db = createDb()
    createSession(db, 'sess-1')
    const order: string[] = []
    let release: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async (run) => {
          order.push(`start:${run.id}`)
          if (run.id === 'first') await firstGate
          order.push(`end:${run.id}`)
          return {type: 'succeeded', output: null}
        },
      },
      pollIntervalMs: 5,
    })
    track(db, queue)
    queue.enqueue(agentSpec({id: 'first', sessionId: 'sess-1'}))
    queue.enqueue(agentSpec({id: 'second', sessionId: 'sess-1'}))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(order).toEqual(['start:first'])
    release()
    await queue.awaitIdle()
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  test('sweepAtBoot requeues claimed/running rows', () => {
    const db = createDb()
    const queue = new runs.RunQueue(db, {executors: {}})
    track(db, queue)
    const run = queue.enqueue(agentSpec({dispatch: false}))
    db.run(`UPDATE runs SET status = 'running', lease_owner = 'dead-process' WHERE id = ?`, [run.id])
    const fresh = new runs.RunQueue(db, {executors: {}})
    const swept = fresh.sweepAtBoot()
    fresh.stop()
    expect(swept).toBe(1)
    const after = runs.getRun(db, ACCOUNT, run.id)
    expect(after?.status).toBe('queued')
    expect(after?.attempt).toBe(0)
  })

  test('parked runs hold no slot and resume via requeueWaiting', async () => {
    const db = createDb()
    let phase = 0
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async () => {
          phase += 1
          if (phase === 1) return {type: 'parked', wait: {reason: 'children', toolCallIds: ['tc-1']}}
          return {type: 'succeeded', output: {resumed: true}}
        },
      },
      pollIntervalMs: 5,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec())
    await queue.awaitIdle()
    const parked = runs.getRun(db, ACCOUNT, run.id)
    expect(parked?.status).toBe('waiting')
    expect(parked?.wait).toEqual({reason: 'children', toolCallIds: ['tc-1']})
    queue.requeueWaiting(run.id)
    const final = await untilTerminal(db, run.id)
    expect(final.status).toBe('succeeded')
    expect(final.output).toEqual({resumed: true})
  })

  test('cancelTree cancels queued descendants and finalizes them', async () => {
    const db = createDb()
    const finalized: string[] = []
    const queue = new runs.RunQueue(db, {
      executors: {},
      onRunFinalized: (run) => finalized.push(run.id),
    })
    track(db, queue)
    const root = queue.enqueue(agentSpec({id: 'root', dispatch: false}))
    queue.enqueue(agentSpec({id: 'child', parentRunId: root.id, dispatch: false}))
    queue.enqueue(agentSpec({id: 'grandchild', parentRunId: 'child', dispatch: false}))
    const affected = queue.cancelTree(ACCOUNT, root.id)
    expect(affected.map((run) => run.id).sort()).toEqual(['child', 'grandchild', 'root'])
    for (const id of ['root', 'child', 'grandchild']) {
      expect(runs.getRun(db, ACCOUNT, id)?.status).toBe('canceled')
    }
    expect(finalized.sort()).toEqual(['child', 'grandchild', 'root'])
  })

  test('child usage rolls up into the parent when the child finalizes', async () => {
    const db = createDb()
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async (run) => {
          if (run.id === 'child') {
            queue.updateUsage(run.id, {input: 10, output: 5, cacheRead: 1, cacheWrite: 0, total: 16})
          }
          return {type: 'succeeded', output: null}
        },
      },
      pollIntervalMs: 5,
    })
    track(db, queue)
    const root = queue.enqueue(agentSpec({id: 'parent', dispatch: false}))
    queue.enqueue(agentSpec({id: 'child', parentRunId: root.id}))
    await queue.awaitIdle()
    const parent = runs.getRun(db, ACCOUNT, 'parent')
    expect(parent?.usage?.children).toEqual({input: 10, output: 5, cacheRead: 1, cacheWrite: 0, total: 16, runs: 1})
    const child = runs.getRun(db, ACCOUNT, 'child')
    expect(child?.rootRunId).toBe('parent')
    expect(child?.depth).toBe(1)
  })

  test('deterministic ids make duplicate enqueue a no-op', () => {
    const db = createDb()
    const queue = new runs.RunQueue(db, {executors: {}})
    track(db, queue)
    const first = queue.enqueue(agentSpec({id: 'firing-abc', dispatch: false, title: 'one'}))
    const second = queue.enqueue(agentSpec({id: 'firing-abc', dispatch: false, title: 'two'}))
    expect(first.id).toBe(second.id)
    expect(second.title).toBe('one')
    const count = db.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM runs`).get()?.n
    expect(count).toBe(1)
  })

  test('canceled is sticky: a cancellation landing mid-execution wins over the outcome', async () => {
    const db = createDb()
    let cancelDuringRun: () => void = () => {}
    const queue = new runs.RunQueue(db, {
      executors: {
        agent: async () => {
          cancelDuringRun()
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {type: 'succeeded', output: {should: 'not-win'}}
        },
      },
      pollIntervalMs: 5,
    })
    track(db, queue)
    const run = queue.enqueue(agentSpec({id: 'racy'}))
    cancelDuringRun = () => {
      db.run(`UPDATE runs SET status = 'canceled', finished_at = ?, updated_at = ? WHERE id = 'racy'`, [
        Date.now(),
        Date.now(),
      ])
    }
    await queue.awaitIdle()
    const final = runs.getRun(db, ACCOUNT, run.id)
    expect(final?.status).toBe('canceled')
    expect(final?.output).toBeUndefined()
  })
})

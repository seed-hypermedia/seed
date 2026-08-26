import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from '@/api-service'
import * as blobs from '@shm/shared/blobs'
import {encode as cborEncode, decode as cborDecode} from '@/cbor'
import * as runs from '@/runs'
import * as runEvents from '@/run-events'
import * as sqlite from '@/sqlite'
import type {WorkflowJournalEntry} from '@/workflow-host'

/**
 * Runs that wait, and runs that hand themselves on.
 *
 * These drive real workflow runs through the real queue — enqueued as rows, executed by the
 * service's own workflow executor — because everything M5 adds is about what survives a park: a
 * restart, a race between a signal and a timeout, a fresh journal on the other side of a
 * continuation. A faked queue would prove none of that.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

type Harness = {
  db: Database
  dataDir: string
  accountId: string
  agentId: string
  account: ReturnType<typeof blobs.generateNobleKeyPair>
  service: apisvc.Service
  /** Replaces the running service with a fresh one on the same database, as a restart would. */
  restart: () => apisvc.Service
}

async function createHarness(): Promise<Harness> {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-time-test-'))
  const account = blobs.generateNobleKeyPair()
  let service = new apisvc.Service(db, dataDir, {})
  await service.message(
    await apisvc.createSignedEnvelope(account, {
      action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
    }),
  )
  await service.message(
    await apisvc.createSignedEnvelope(account, {
      action: {
        _: 'SetModelProvider',
        name: 'openai',
        provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
      },
    }),
  )
  const created = await service.message(
    await apisvc.createSignedEnvelope(account, {
      action: {
        _: 'CreateAgent',
        definition: {name: 'Timer', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt-test'},
      },
    }),
  )
  if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const accountId = blobs.principalToString(account.principal)
  const harness: Harness = {
    db,
    dataDir,
    accountId,
    agentId: created.agentId,
    account,
    get service() {
      return service
    },
    restart: () => {
      service.stopRunQueue()
      service = new apisvc.Service(db, dataDir, {})
      return service
    },
  } as Harness
  cleanups.push(() => {
    service.stopRunQueue()
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return harness
}

/**
 * Enqueues a workflow run the way a delegate call would, minus the model, and starts a service on
 * it. Restarting is how the row gets picked up (the boot sweep looks for queued work), which also
 * means every one of these runs begins the way a real one does after a deploy.
 */
function enqueueWorkflow(
  harness: Harness,
  options: {id: string; source: string; input?: unknown; createdAt?: number; budget?: runs.RunBudget},
): void {
  const now = options.createdAt ?? Date.now()
  harness.db.run(
    `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, origin, title, source_text,
       input_cbor, status, attempt, max_attempts, queue, budget_cbor, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'workflow', ?, 'agent', 'Waiter', ?, ?, 'queued', 0, 1, 'background', ?, ?, ?)`,
    [
      options.id,
      harness.accountId,
      options.id,
      harness.agentId,
      options.source,
      cborEncode({input: options.input ?? null}),
      options.budget ? cborEncode(options.budget) : null,
      now,
      now,
    ],
  )
  harness.restart()
}

async function untilRun(
  harness: Harness,
  runId: string,
  predicate: (run: runs.RunRecord) => boolean,
  timeoutMs = 5_000,
): Promise<runs.RunRecord> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = runs.getRun(harness.db, harness.accountId, runId)
    if (run && predicate(run)) return run
    if (Date.now() > deadline)
      throw new Error(`run ${runId} never settled: ${run?.status} ${JSON.stringify(run?.wait)}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function journalOf(harness: Harness, runId: string): WorkflowJournalEntry[] {
  return harness.db
    .query<{entry_cbor: Uint8Array}, [string]>(`SELECT entry_cbor FROM run_journal WHERE run_id = ? ORDER BY seq ASC`)
    .all(runId)
    .map((row) => cborDecode<WorkflowJournalEntry>(row.entry_cbor))
}

async function signal(
  harness: Harness,
  runId: string,
  signalName: string,
  payload?: unknown,
): Promise<{delivered: boolean}> {
  const response = await harness.service.message(
    await apisvc.createSignedEnvelope(harness.account, {
      action: {_: 'SignalRun', runId, signal: signalName, ...(payload === undefined ? {} : {payload})},
    }),
  )
  if (response._ !== 'SignalRunResponse') throw new Error('unexpected response')
  return {delivered: response.delivered}
}

describe('waiting for something to happen', () => {
  test('a park survives a restart, one signal wakes it, and a second delivers nothing', async () => {
    const harness = await createHarness()
    enqueueWorkflow(harness, {
      id: 'wait-run',
      source: `export default async function (input, ctx) {
        const event = await ctx.waitForEvent({signal: 'approved'}, {label: 'sign-off'})
        return 'approved by ' + event.payload.by
      }`,
    })

    const parked = await untilRun(harness, 'wait-run', (run) => run.status === 'waiting')
    expect(parked.wait).toMatchObject({reason: 'event', label: 'sign-off'})
    expect(runEvents.listRunEventWaits(harness.db, 'wait-run')).toHaveLength(1)

    // Restart: nothing in memory carries the wait, so it has to be in the database or it is lost.
    harness.restart()
    const afterRestart = runs.getRun(harness.db, harness.accountId, 'wait-run')
    expect(afterRestart?.status).toBe('waiting')
    expect(runEvents.listRunEventWaits(harness.db, 'wait-run')).toHaveLength(1)

    expect((await signal(harness, 'wait-run', 'approved', {by: 'Ada'})).delivered).toBe(true)
    const finished = await untilRun(harness, 'wait-run', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(finished.status).toBe('succeeded')
    expect(finished.output).toBe('approved by Ada')

    // Exactly once: the journal holds a single delivery, and a repeat signal finds nobody listening.
    expect(journalOf(harness, 'wait-run').filter((entry) => entry.kind === 'event')).toHaveLength(1)
    expect(runEvents.listRunEventWaits(harness.db, 'wait-run')).toHaveLength(0)
    expect((await signal(harness, 'wait-run', 'approved', {by: 'Bob'})).delivered).toBe(false)
  })

  test('a wait that times out resumes without a payload, and a late signal is not delivered', async () => {
    const harness = await createHarness()
    enqueueWorkflow(harness, {
      id: 'timeout-run',
      source: `export default async function (input, ctx) {
        const event = await ctx.waitForEvent({signal: 'approved'}, {timeoutMs: 60})
        return event === null ? 'gave up' : 'answered'
      }`,
    })
    await untilRun(harness, 'timeout-run', (run) => run.status === 'waiting')

    // The queue's own timer sweep wakes it; nothing signals it.
    const finished = await untilRun(harness, 'timeout-run', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(finished.status).toBe('succeeded')
    expect(finished.output).toBe('gave up')
    // The wait is gone, so a signal that arrives late cannot resurrect a decision already made.
    expect((await signal(harness, 'timeout-run', 'approved')).delivered).toBe(false)
  })

  test('an activity event wakes the run that was listening for it', async () => {
    const harness = await createHarness()
    enqueueWorkflow(harness, {
      id: 'activity-run',
      source: `export default async function (input, ctx) {
        const event = await ctx.waitForEvent({eventType: 'Comment', resource: 'hm://z6MkDoc/spec'})
        return 'saw ' + event.payload.type
      }`,
    })
    await untilRun(harness, 'activity-run', (run) => run.status === 'waiting')

    await harness.service.processActivityEvent(harness.accountId, {
      type: 'Comment',
      resource: 'hm://z6MkDoc/spec?v=2',
      author: 'z6MkSomeone',
    })
    const finished = await untilRun(harness, 'activity-run', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(finished.output).toBe('saw Comment')
  })
})

describe('continuing as a new run', () => {
  test('the successor carries the declared state, keeps the work, and starts a fresh journal', async () => {
    const harness = await createHarness()
    enqueueWorkflow(harness, {
      id: 'gen-0',
      input: {n: 0},
      source: `export default async function (input, ctx) {
        const n = (input && input.n) || 0
        await ctx.log('info', 'generation ' + n)
        if (n < 1) await ctx.continueAsNew({n: n + 1})
        return 'done at ' + n
      }`,
    })

    const first = await untilRun(harness, 'gen-0', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(first.status).toBe('succeeded')
    const output = first.output as {continued?: boolean; continuedAsRunId?: string}
    expect(output.continued).toBe(true)
    const successorId = output.continuedAsRunId!
    expect(successorId).toBeTruthy()

    const successor = await untilRun(harness, successorId, (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(successor.continuedFromRunId).toBe('gen-0')
    expect(successor.output).toBe('done at 1')
    // Only the declared state crossed over — not the predecessor's journal.
    expect((successor.input as {input?: unknown}).input).toEqual({n: 1})
    const successorJournal = journalOf(harness, successorId)
    expect(successorJournal.some((entry) => entry.kind === 'log' && entry.message === 'generation 1')).toBe(true)
    expect(successorJournal.some((entry) => entry.kind === 'log' && entry.message === 'generation 0')).toBe(false)
  })
})

describe('pausing on a budget', () => {
  test('a run past its time budget pauses for a person, and a signal lets it finish', async () => {
    const harness = await createHarness()
    enqueueWorkflow(harness, {
      id: 'budget-run',
      // Created two hours ago with a one-hour budget: it is over before it starts.
      createdAt: Date.now() - 2 * 60 * 60 * 1000,
      budget: {maxWallMs: 60 * 60 * 1000},
      source: `export default async function () { return 'finished anyway' }`,
    })

    const paused = await untilRun(harness, 'budget-run', (run) => run.status === 'waiting')
    expect(paused.wait?.reason).toBe('budget-pause')
    expect(String((paused.wait as {note?: string}).note)).toContain('time budget')
    // No wake time: the clock will never release this one.
    expect(paused.notBefore).toBeUndefined()

    expect((await signal(harness, 'budget-run', 'resume')).delivered).toBe(true)
    const finished = await untilRun(harness, 'budget-run', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(finished.output).toBe('finished anyway')
    // The limit that stopped it was dropped, not merely deferred, so it did not pause again.
    expect(finished.budget?.maxWallMs).toBeUndefined()
  })
})

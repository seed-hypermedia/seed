import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import {createBootRoutes} from '@/main'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// The parked-parent reconcile used to run inside the Service constructor, so the server could not
// listen until it finished (about 100 s of boot on the production file, 2026-11-10). It now runs
// after the server listens, a run at a time, next to live dispatch.

describe('boot recovery after listen', () => {
  test('the constructor leaves parked parents alone; recoverAfterBoot replays the finished child once', async () => {
    const fixture = await createParkedFixture(['parent-a'])
    let svc: apisvc.Service | undefined
    try {
      svc = fixture.restart()
      expect(statusOf(fixture.db, 'parent-a')).toBe('waiting')
      expect(svc.bootRecoveryStatus()).toEqual({state: 'pending'})

      await svc.recoverAfterBoot()

      // The child's result is in the parent's transcript, and the parent is back in the queue
      // (model dispatch is capped at zero here, so it stays queued instead of calling a provider).
      expect(statusOf(fixture.db, 'parent-a')).toBe('queued')
      expect(toolResults(fixture.db, fixture.parentSession('parent-a'), 'spawn-parent-a')).toBe(1)
      expect(svc.bootRecoveryStatus().state).toBe('done')

      // Running it again is a no-op: the status is no longer pending.
      await svc.recoverAfterBoot()
      expect(toolResults(fixture.db, fixture.parentSession('parent-a'), 'spawn-parent-a')).toBe(1)
    } finally {
      svc?.stopRunQueue()
      fixture.close()
    }
  })

  test('steps yield to the event loop, and a parent resolved or canceled in between is not resolved again', async () => {
    const fixture = await createParkedFixture(['parent-a', 'parent-b', 'parent-c'])
    let svc: apisvc.Service | undefined
    try {
      svc = fixture.restart()
      let timerFired = false
      setTimeout(() => {
        timerFired = true
      }, 0)

      const recovering = svc.recoverAfterBoot({yieldEvery: 1})
      // The first parked run is handled before the first yield; the others wait for later turns.
      expect(statusOf(fixture.db, 'parent-a')).toBe('queued')
      expect(statusOf(fixture.db, 'parent-b')).toBe('waiting')
      expect(svc.bootRecoveryStatus()).toEqual({state: 'running'})
      expect(timerFired).toBe(false)

      // Between steps, the live path answers parent-b (its child's finalizer ran) and someone
      // cancels parent-c. The boot pass must see both from a fresh read.
      fixture.db.run(
        `INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, 3, ?, ?)`,
        [
          crypto.randomUUID(),
          fixture.parentSession('parent-b'),
          cbor.encode({type: 'tool_result', toolCallId: 'spawn-parent-b', name: 'delegate', output: {status: 'ok'}}),
          Date.now(),
        ],
      )
      fixture.db.run(`UPDATE runs SET status = 'queued', wait_cbor = NULL WHERE id = 'parent-b'`)
      fixture.db.run(`UPDATE runs SET status = 'canceled', wait_cbor = NULL WHERE id = 'parent-c'`)

      await recovering
      expect(timerFired).toBe(true)
      expect(toolResults(fixture.db, fixture.parentSession('parent-b'), 'spawn-parent-b')).toBe(1)
      expect(toolResults(fixture.db, fixture.parentSession('parent-c'), 'spawn-parent-c')).toBe(0)
      expect(statusOf(fixture.db, 'parent-c')).toBe('canceled')
      expect(svc.bootRecoveryStatus().state).toBe('done')
    } finally {
      svc?.stopRunQueue()
      fixture.close()
    }
  })

  test('a parent whose wait answer is already in its transcript is requeued without a second result', async () => {
    const fixture = await createParkedFixture(['parent-a'], {childStatus: 'queued'})
    let svc: apisvc.Service | undefined
    try {
      // The crash landed after the tool_result append and before the wait resolution.
      fixture.db.run(
        `INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, 3, ?, ?)`,
        [
          crypto.randomUUID(),
          fixture.parentSession('parent-a'),
          cbor.encode({type: 'tool_result', toolCallId: 'spawn-parent-a', name: 'delegate', output: {status: 'ok'}}),
          Date.now(),
        ],
      )
      svc = fixture.restart()
      await svc.recoverAfterBoot()
      expect(statusOf(fixture.db, 'parent-a')).toBe('queued')
      expect(toolResults(fixture.db, fixture.parentSession('parent-a'), 'spawn-parent-a')).toBe(1)
    } finally {
      svc?.stopRunQueue()
      fixture.close()
    }
  })
})

describe('boot routes', () => {
  test('health answers 503 starting with the current phase on every health path', async () => {
    const boot = {phase: 'opening the database'}
    const routes = createBootRoutes(boot)
    for (const route of ['/hm/api/agents/health', '/api/health', '/agents/api/health']) {
      const handler = (routes[route] as {GET: () => Response}).GET
      const res = handler()
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBe('5')
      const body = (await res.json()) as {status: string; phase: string; reason: string}
      expect(body.status).toBe('starting')
      expect(body.phase).toBe('opening the database')
      expect(body.reason).toContain('opening the database')
    }
    boot.phase = 'starting the run queue'
    const body = (await (routes['/api/health'] as {GET: () => Response}).GET().json()) as {phase: string}
    expect(body.phase).toBe('starting the run queue')
  })
})

type ParkedFixture = {
  db: Database
  restart: () => apisvc.Service
  parentSession: (parentRunId: string) => string
  close: () => void
}

/**
 * Forges what a crash leaves behind: for each id, a parent run `waiting` on one delegated child
 * whose run already reached `succeeded` (or `childStatus`), with the parent's resolution never
 * committed. `restart()` builds the Service the way a boot does, with model dispatch capped at
 * zero so a requeued parent stays observable in `queued`.
 */
async function createParkedFixture(
  parentRunIds: string[],
  options: {childStatus?: 'succeeded' | 'queued'} = {},
): Promise<ParkedFixture> {
  const db = new Database(':memory:', {create: true, strict: true})
  const opened = sqlite.openWithDatabase(db)
  if (!opened.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-boot-test-'))
  const account = blobs.generateNobleKeyPair()
  const accountId = blobs.principalToString(account.principal)
  const setup = new apisvc.Service(db, dataDir, {runQueue: {maxConcurrentModelRuns: 0}})
  const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
    setup.message(await apisvc.createSignedEnvelope(account, {action}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const agent = await send({
    _: 'CreateAgent',
    definition: {name: 'Parker', systemPrompt: 'Coordinate.', modelProvider: 'openai', model: 'gpt', tools: []},
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const sessions = new Map<string, string>()
  const now = Date.now()
  const putEvent = (sessionId: string, seq: number, event: unknown) =>
    db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
      crypto.randomUUID(),
      sessionId,
      seq,
      cbor.encode(event),
      now,
    ])
  for (const parentRunId of parentRunIds) {
    const parent = await send({_: 'CreateSession', agentId: agent.agentId})
    const child = await send({_: 'CreateSession', agentId: agent.agentId})
    if (parent._ !== 'CreateSessionResponse' || child._ !== 'CreateSessionResponse') throw new Error('unexpected')
    sessions.set(parentRunId, parent.sessionId)
    const toolCallId = `spawn-${parentRunId}`
    putEvent(parent.sessionId, 1, {type: 'message', role: 'user', content: 'Delegate the work'})
    putEvent(parent.sessionId, 2, {type: 'tool_call', id: toolCallId, name: 'delegate', input: {input: 'Do it'}})
    db.run(
      `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, session_id, origin, input_cbor,
         status, wait_cbor, attempt, max_attempts, queue, created_at, started_at, updated_at)
       VALUES (?, ?, ?, 0, 'agent', ?, ?, 'user', ?, 'waiting', ?, 1, 1, 'interactive', ?, ?, ?)`,
      [
        parentRunId,
        accountId,
        parentRunId,
        agent.agentId,
        parent.sessionId,
        cbor.encode({}),
        cbor.encode({reason: 'children', toolCallIds: [toolCallId]}),
        now,
        now,
        now,
      ],
    )
    const childStatus = options.childStatus ?? 'succeeded'
    db.run(
      `INSERT INTO runs (id, account_id, root_run_id, parent_run_id, depth, kind, agent_id, session_id, origin,
         input_cbor, output_cbor, status, attempt, max_attempts, queue, created_at, finished_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'agent', ?, ?, 'agent', ?, ?, ?, 1, 1, 'background', ?, ?, ?)`,
      [
        `child-of-${parentRunId}`,
        accountId,
        parentRunId,
        parentRunId,
        agent.agentId,
        child.sessionId,
        cbor.encode({parentToolCallId: toolCallId, parentToolName: 'delegate'}),
        childStatus === 'succeeded' ? cbor.encode({text: 'done'}) : null,
        childStatus,
        now,
        childStatus === 'succeeded' ? now : null,
        now,
      ],
    )
    db.run(`UPDATE sessions SET parent_session_id = ?, run_id = ? WHERE id = ?`, [
      parent.sessionId,
      `child-of-${parentRunId}`,
      child.sessionId,
    ])
  }
  setup.stopRunQueue()
  return {
    db,
    restart: () => new apisvc.Service(db, dataDir, {runQueue: {maxConcurrentModelRuns: 0}}),
    parentSession: (parentRunId) => {
      const sessionId = sessions.get(parentRunId)
      if (!sessionId) throw new Error(`no parent ${parentRunId}`)
      return sessionId
    },
    close: () => {
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    },
  }
}

function statusOf(db: Database, runId: string): string | undefined {
  return db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE id = ?`).get(runId)?.status
}

function toolResults(db: Database, sessionId: string, toolCallId: string): number {
  return db
    .query<{event_cbor: Uint8Array}, [string]>(`SELECT event_cbor FROM session_events WHERE session_id = ?`)
    .all(sessionId)
    .map((row) => cbor.decode<{type?: string; toolCallId?: string}>(row.event_cbor))
    .filter((event) => event.type === 'tool_result' && event.toolCallId === toolCallId).length
}

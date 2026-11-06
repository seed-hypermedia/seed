import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Production-shaped regression guard for the account listing path.
 *
 * On 2026-11-03 the agents server went dark with its one thread at 90% CPU inside ListSessions:
 * the `busy` flag on every agent row ran a correlated EXISTS over `runs` that was pinned to
 * `runs_dispatch`, an index without an agent column, so every non-busy agent re-walked every live
 * run (120–200 ms per ListAgents on the 36 GB production file, paid again by GetAgent, by every
 * ListSessions page labelling its rows, and by every session-event emit). The fixture here is the
 * production shape in miniature — tens of agents, tens of thousands of sessions and runs, a few
 * dozen live runs — and the budget is an order of magnitude above what a correct plan costs.
 */

const AGENT_COUNT = 30
const SESSION_COUNT = 20_000
const RUN_COUNT = 50_000
const LIVE_RUN_COUNT = 70
const LIVE_STATUSES = ['queued', 'claimed', 'running', 'waiting'] as const
const BUDGET_MS = 10

describe('listing performance on a production-shaped database', () => {
  test('busy is answered from the covering runs_by_agent_status index, with and without statistics', () => {
    const db = createDatabase()
    try {
      const sql = `SELECT a.id, ${apisvc.agentActivityColumns('a')} FROM agents a WHERE a.account_id = ?`
      for (const analyzed of [false, true]) {
        if (analyzed) sqlite.analyzePlannerTables(db)
        const plan = db
          .query<{detail: string}, []>(`EXPLAIN QUERY PLAN ${sql}`)
          .all()
          .map((row) => row.detail)
          .join('\n')
        expect(plan).toContain('USING COVERING INDEX runs_by_agent_status')
        expect(plan).not.toContain('runs_dispatch')
        expect(plan).not.toContain('SCAN runs')
      }
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('ListAgents, ListSessions and GetAgent stay within budget against 30 agents, 20k sessions and 50k runs', async () => {
    const db = createDatabase()
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-list-perf-'))
    const svc = new apisvc.Service(db, dataDir, {runQueue: {maxConcurrentModelRuns: 0}})
    // The fixture inserts live runs directly; the queue must not try to claim or expire them.
    svc.stopRunQueue()
    try {
      const owner = blobs.generateNobleKeyPair()
      const send = async (action: import('@/api').UnsignedAgentAction) =>
        svc.message(await apisvc.createSignedEnvelope(owner, {action}))
      const accountId = blobs.principalToString(owner.principal)
      await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
      await send({
        _: 'SetModelProvider',
        name: 'openai',
        provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
      })
      const agentIds: string[] = []
      for (let i = 0; i < AGENT_COUNT; i += 1) {
        const created = await send({
          _: 'CreateAgent',
          definition: {name: `Agent ${i}`, systemPrompt: 'Test', modelProvider: 'openai', model: 'gpt-test', tools: []},
        })
        if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
        agentIds.push(created.agentId)
      }
      seedSessionsAndRuns(db, accountId, agentIds)
      // Production opens with statistics in place (openWithDatabase analyzes on every start).
      sqlite.analyzePlannerTables(db)
      expect(
        db
          .query<{n: number}, []>(
            `SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued', 'claimed', 'running', 'waiting')`,
          )
          .get()?.n,
      ).toBe(LIVE_RUN_COUNT)

      const timings: Record<string, number> = {}
      const measure = async (label: string, action: import('@/api').UnsignedAgentAction) => {
        // Signing and verification are part of what the server does per request, so they are timed
        // too. Warm the statement cache once, then take the median of a few runs so a GC pause on a
        // busy CI host does not fail the gate.
        const envelope = await apisvc.createSignedEnvelope(owner, {action})
        await svc.message(envelope)
        const samples: number[] = []
        for (let i = 0; i < 5; i += 1) {
          const started = performance.now()
          await svc.message(envelope)
          samples.push(performance.now() - started)
        }
        samples.sort((a, b) => a - b)
        timings[label] = samples[Math.floor(samples.length / 2)]!
      }

      await measure('ListAgents', {_: 'ListAgents'})
      await measure('ListSessions', {_: 'ListSessions', includeChildren: false})
      await measure('ListSessions:agent', {_: 'ListSessions', agentId: agentIds[0]!, includeChildren: false})
      await measure('GetAgent', {_: 'GetAgent', agentId: agentIds[0]!})

      const listed = await send({_: 'ListAgents'})
      if (listed._ !== 'ListAgentsResponse') throw new Error('unexpected response')
      expect(listed.agents).toHaveLength(AGENT_COUNT)
      const sessions = await send({_: 'ListSessions', includeChildren: false})
      if (sessions._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(sessions.sessions.length).toBeGreaterThan(0)
      // Every referenced agent is labelled, and only referenced agents are returned.
      expect(new Set(sessions.agents.map((agent) => agent.id))).toEqual(
        new Set(sessions.sessions.map((session) => session.agentId)),
      )

      console.log('[list-perf] median ms per action', timings)
      for (const [label, ms] of Object.entries(timings)) {
        expect(
          ms,
          `${label} took ${ms.toFixed(2)} ms (budget ${BUDGET_MS} ms); timings: ${JSON.stringify(timings)}`,
        ).toBeLessThan(BUDGET_MS)
      }
    } finally {
      svc.stopRunQueue()
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  }, 60_000)
})

function createDatabase(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  return db
}

/** Sessions and runs spread round-robin across the agents, with a few dozen live runs among them. */
function seedSessionsAndRuns(db: Database, accountId: string, agentIds: string[]): void {
  const base = 1_700_000_000_000
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, account_id, agent_id, title, status, created_at, updated_at, message_at, message_from)
     VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, 'user')`,
  )
  const insertRun = db.prepare(
    `INSERT INTO runs (id, account_id, root_run_id, kind, agent_id, session_id, origin, title, input_cbor, status, queue,
                       lease_owner, lease_expires_at, not_before, created_at, updated_at)
     VALUES (?, ?, ?, 'agent', ?, ?, 'user', ?, X'A0', ?, 'background', ?, ?, ?, ?, ?)`,
  )
  const farFuture = Date.now() + 24 * 60 * 60 * 1000
  db.transaction(() => {
    for (let i = 0; i < SESSION_COUNT; i += 1) {
      const at = base + i * 1000
      insertSession.run(`session-${i}`, accountId, agentIds[i % agentIds.length]!, `Session ${i}`, at, at, at)
    }
    // Live runs sit on the newest sessions, concentrated on a few agents, as on production: most
    // agents have no live run and must answer `busy = 0` without walking the live rows.
    const liveEvery = Math.floor(RUN_COUNT / LIVE_RUN_COUNT)
    let live = 0
    for (let i = 0; i < RUN_COUNT; i += 1) {
      const isLive = live < LIVE_RUN_COUNT && i % liveEvery === liveEvery - 1
      const status = isLive ? LIVE_STATUSES[live % LIVE_STATUSES.length]! : 'succeeded'
      if (isLive) live += 1
      const agentId = isLive ? agentIds[live % 3]! : agentIds[i % agentIds.length]!
      const at = base + i * 400
      insertRun.run(
        `run-${i}`,
        accountId,
        `run-${i}`,
        agentId,
        `session-${i % SESSION_COUNT}`,
        `Run ${i}`,
        status,
        status === 'claimed' || status === 'running' ? 'fixture' : null,
        status === 'claimed' || status === 'running' ? farFuture : null,
        status === 'queued' || status === 'waiting' ? farFuture : null,
        at,
        at,
      )
    }
  })()
}

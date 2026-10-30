import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as sqlite from './sqlite.ts'
import * as effectOutbox from './effect-outbox.ts'

/**
 * The effect outbox on its own: the intent of a side effect is recorded before it runs, its
 * receipt after, a rerun is answered from the row, and a boot settles what a dead process left.
 */

const ACCOUNT = 'acct-1'
const SESSION = 'session-1'

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
  db.run(`INSERT INTO sessions (id, account_id, agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    SESSION,
    ACCOUNT,
    'agent-1',
    'idle',
    now,
    now,
  ])
  return db
}

function beginWrite(db: Database, overrides: Partial<effectOutbox.BeginOptions> = {}): effectOutbox.Disposition {
  return effectOutbox.begin(db, {
    accountId: ACCOUNT,
    sessionId: SESSION,
    runId: 'run-1',
    toolCallId: 'call-1',
    tool: 'write',
    kind: 'memory-write',
    args: {address: '~/memory/notes.md', content: 'hello'},
    owner: 'process-a',
    ...overrides,
  })
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('classifyEffect', () => {
  test('reads, plan and status repeat freely', () => {
    for (const tool of ['read', 'plan', 'status']) {
      expect(effectOutbox.classifyEffect(tool, {})).toEqual({kind: 'read', repeatable: true})
    }
  })

  test('a write is named by its address, and a rehearsal is a read', () => {
    expect(effectOutbox.classifyEffect('write', {address: 'hm://z6Mkdoc/notes', content: 'x'})).toEqual({
      kind: 'publish',
      repeatable: false,
    })
    expect(effectOutbox.classifyEffect('write', {address: 'hm://z6Mkdoc/notes', content: 'x', dryRun: true})).toEqual({
      kind: 'read',
      repeatable: true,
    })
    expect(effectOutbox.classifyEffect('write', {address: '~/memory/a.md'}).kind).toBe('memory-write')
    expect(effectOutbox.classifyEffect('write', {address: '~/triggers/daily'}).kind).toBe('trigger-write')
    expect(effectOutbox.classifyEffect('write', {address: '~/tools/fetch'}).kind).toBe('tool-write')
    expect(effectOutbox.classifyEffect('write', {address: 'ipfs://'}).kind).toBe('ipfs-upload')
  })

  test('a call is named by what it calls; read-only callables repeat, everything else is recorded', () => {
    for (const name of ['search', 'query', 'attributes', 'web_search']) {
      expect(effectOutbox.classifyEffect('call', {tool: name, input: {}}).repeatable).toBe(true)
      // A promoted callable is offered under its own name.
      expect(effectOutbox.classifyEffect(name, {}).repeatable).toBe(true)
    }
    expect(effectOutbox.classifyEffect('call', {tool: 'execute', input: {}})).toEqual({
      kind: 'execute',
      repeatable: false,
    })
    expect(effectOutbox.classifyEffect('execute', {code: 'print(1)'})).toEqual({kind: 'execute', repeatable: false})
    expect(effectOutbox.classifyEffect('call', {tool: 'github_create_issue'})).toEqual({
      kind: 'call:github_create_issue',
      repeatable: false,
    })
    // A call with no tool name answers with the listing: nothing to record.
    expect(effectOutbox.classifyEffect('call', {}).repeatable).toBe(true)
  })

  test('delegation and the turn-ending verbs are recorded under their own names', () => {
    expect(effectOutbox.classifyEffect('delegate', {input: 'go'})).toEqual({kind: 'delegate', repeatable: false})
    expect(effectOutbox.classifyEffect('continue_session', {}).kind).toBe('continue-session')
    expect(effectOutbox.classifyEffect('return_result', {}).kind).toBe('return-result')
  })
})

describe('effect outbox', () => {
  test('a first call runs, and its receipt answers every later call with the same arguments', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const first = beginWrite(db)
    expect(first.state).toBe('run')
    if (first.state !== 'run') throw new Error('unexpected')
    expect(first.row.status).toBe('running')
    expect(first.row.leaseOwner).toBe('process-a')
    expect(first.row.kind).toBe('memory-write')

    effectOutbox.complete(db, first.row.id, {
      response: {output: [{type: 'text', text: 'Wrote notes.md'}], details: {ok: 1}},
    })
    const again = beginWrite(db)
    expect(again.state).toBe('settled')
    if (again.state !== 'settled') throw new Error('unexpected')
    expect(again.row.status).toBe('succeeded')
    expect(again.row.response).toEqual({output: [{type: 'text', text: 'Wrote notes.md'}], details: {ok: 1}})
    expect(again.row.leaseOwner).toBeNull()
  })

  test('a failed effect is a receipt too: the error is returned, the effect is not retried', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const first = beginWrite(db)
    if (first.state !== 'run') throw new Error('unexpected')
    effectOutbox.complete(db, first.row.id, {error: 'disk quota exceeded'})
    const again = beginWrite(db)
    expect(again.state).toBe('settled')
    if (again.state !== 'settled') throw new Error('unexpected')
    expect(again.row.status).toBe('failed')
    expect(again.row.error).toBe('disk quota exceeded')
  })

  test('a receipt never answers a call whose arguments changed', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const first = beginWrite(db)
    if (first.state !== 'run') throw new Error('unexpected')
    effectOutbox.complete(db, first.row.id, {response: {output: []}})
    // Same call id, other content: the old row is replaced and the call runs.
    const changed = beginWrite(db, {args: {address: '~/memory/notes.md', content: 'something else'}})
    expect(changed.state).toBe('run')
    expect(effectOutbox.listForSession(db, SESSION)).toHaveLength(1)
  })

  test('the digest ignores key order and undefined members', () => {
    expect(effectOutbox.inputDigest({a: 1, b: [1, {c: 2, d: undefined}]})).toBe(
      effectOutbox.inputDigest({b: [1, {d: undefined, c: 2}], a: 1}),
    )
    expect(effectOutbox.inputDigest({a: 1})).not.toBe(effectOutbox.inputDigest({a: 2}))
  })

  test('a row another process left running is interrupted, and stays interrupted', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const first = beginWrite(db, {owner: 'process-a'})
    expect(first.state).toBe('run')
    // The next process reruns the call: the first process never settled it.
    const rerun = beginWrite(db, {owner: 'process-b'})
    expect(rerun.state).toBe('interrupted')
    if (rerun.state !== 'interrupted') throw new Error('unexpected')
    expect(rerun.row.status).toBe('interrupted')
    expect(rerun.row.error).toContain('ended before this effect completed')
    expect(effectOutbox.interruptedResultText(rerun.row)).toBe(
      'Interrupted by a service restart while writing a memory file. It may have completed before the restart. Check the result before repeating it.',
    )
    // A late receipt from the dead process cannot flip it: complete() only settles running rows.
    effectOutbox.complete(db, rerun.row.id, {response: {output: []}})
    expect(effectOutbox.get(db, rerun.row.id)?.status).toBe('interrupted')
    expect(beginWrite(db, {owner: 'process-b'}).state).toBe('interrupted')
  })

  test('a row this process is still running is in flight, and expires with its lease', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const now = 1_000_000
    const first = beginWrite(db, {now})
    expect(first.state).toBe('run')
    expect(beginWrite(db, {now: now + 1}).state).toBe('in-flight')
    expect(beginWrite(db, {now: now + effectOutbox.LEASE_MS + 1}).state).toBe('interrupted')
  })

  test('the boot sweep settles every running row before any turn can ask', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const publish = beginWrite(db, {toolCallId: 'call-publish', kind: 'publish', args: {address: 'hm://x/y'}})
    const query = beginWrite(db, {toolCallId: 'call-query', tool: 'call', kind: 'read', args: {tool: 'query'}})
    const done = beginWrite(db, {toolCallId: 'call-done'})
    if (publish.state !== 'run' || query.state !== 'run' || done.state !== 'run') throw new Error('unexpected')
    effectOutbox.complete(db, done.row.id, {response: {output: []}})

    const swept = effectOutbox.sweepAtBoot(db, {repeatable: (kind) => kind === 'read'})
    expect(swept).toEqual({interrupted: 1, cleared: 1})
    expect(effectOutbox.get(db, publish.row.id)?.status).toBe('interrupted')
    expect(effectOutbox.get(db, query.row.id)).toBeNull()
    expect(effectOutbox.get(db, done.row.id)?.status).toBe('succeeded')
  })

  test('an interrupted effect whose outcome turned up elsewhere becomes a receipt', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const spawn = beginWrite(db, {toolCallId: 'call-delegate', tool: 'delegate', kind: 'delegate', args: {input: 'go'}})
    if (spawn.state !== 'run') throw new Error('unexpected')
    effectOutbox.sweepAtBoot(db)
    expect(effectOutbox.get(db, spawn.row.id)?.status).toBe('interrupted')
    const recovered = effectOutbox.recover(db, spawn.row.id, {output: [{type: 'text', text: 'parked'}], parked: true})
    expect(recovered?.status).toBe('succeeded')
    expect(recovered?.response).toEqual({output: [{type: 'text', text: 'parked'}], parked: true})
    // Only an interrupted row recovers; a settled one is left alone.
    expect(effectOutbox.recover(db, spawn.row.id, {output: []})).toBeNull()
  })

  test('settled receipts are pruned after the retention window; running rows never are', () => {
    const db = createDb()
    cleanups.push(() => sqlite.closeDatabase(db))
    const now = 10_000_000_000
    const old = beginWrite(db, {toolCallId: 'call-old', now})
    const fresh = beginWrite(db, {toolCallId: 'call-fresh', now})
    const running = beginWrite(db, {toolCallId: 'call-running', now})
    if (old.state !== 'run' || fresh.state !== 'run' || running.state !== 'run') throw new Error('unexpected')
    effectOutbox.complete(db, old.row.id, {response: {output: []}}, now)
    effectOutbox.complete(db, fresh.row.id, {response: {output: []}}, now + effectOutbox.RETENTION_MS)
    expect(effectOutbox.prune(db, now + effectOutbox.RETENTION_MS + 1)).toBe(1)
    const left = effectOutbox.listForSession(db, SESSION).map((row) => row.toolCallId)
    expect(left).toEqual(['call-fresh', 'call-running'])
  })
})

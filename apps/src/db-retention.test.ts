import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as cbor from '@/cbor'
import * as retention from '@/db-retention'
import * as durableSession from '@/durable-session'
import * as sqlite from '@/sqlite'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 10)
const databases: Database[] = []
afterEach(() => {
  while (databases.length) sqlite.closeDatabase(databases.pop()!)
})

function openDb(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  databases.push(db)
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES ('acct', 0, 0)`)
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
       VALUES ('agent', 'acct', x'a0', '/tmp/none', 'active', 0, 0)`,
  )
  return db
}

const policy = (overrides: Partial<retention.RetentionPolicy> = {}): retention.RetentionPolicy => ({
  ...retention.DEFAULT_RETENTION_POLICY,
  bytesPerSecond: 0,
  ...overrides,
})
const control = {now: NOW, pause: async () => {}}

function addSession(db: Database, id: string, updatedAt: number, storeBytes: number[] = [100, 200]) {
  db.run(
    `INSERT INTO sessions (id, account_id, agent_id, status, created_at, updated_at) VALUES (?, 'acct', 'agent', 'idle', ?, ?)`,
    [id, updatedAt, updatedAt],
  )
  storeBytes.forEach((size, index) =>
    db.run(`INSERT INTO session_durable_files (session_id, file, seq, data) VALUES (?, 'main.jsonl', ?, ?)`, [
      id,
      index + 1,
      new Uint8Array(size),
    ]),
  )
}

function addRun(
  db: Database,
  id: string,
  fields: {status: string; createdAt: number; finishedAt?: number; sessionId?: string},
): void {
  db.run(
    `INSERT INTO runs (id, account_id, root_run_id, kind, origin, input_cbor, status, session_id, created_at, finished_at, updated_at)
       VALUES (?, 'acct', ?, 'workflow', 'agent', x'a0', ?, ?, ?, ?, ?)`,
    [
      id,
      id,
      fields.status,
      fields.sessionId ?? null,
      fields.createdAt,
      fields.finishedAt ?? null,
      fields.finishedAt ?? fields.createdAt,
    ],
  )
}

function addJournal(db: Database, runId: string, seq: number, entry: unknown): void {
  db.run(`INSERT INTO run_journal (run_id, seq, entry_cbor, created_at) VALUES (?, ?, ?, 0)`, [
    runId,
    seq,
    cbor.encode(entry),
  ])
}

const storeRowCount = (db: Database, sessionId: string) =>
  db
    .query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM session_durable_files WHERE session_id = ?`)
    .get(sessionId)!.n

describe('stored tool output cap', () => {
  test('long strings keep their head and a marker; small outputs are returned unchanged', () => {
    const small = {text: 'short', items: [1, 2, 3]}
    expect(retention.boundPersistedToolOutput(small, 10)).toBe(small)

    const bounded = retention.boundPersistedToolOutput({page: {markdown: 'x'.repeat(50)}, ok: true}, 10)
    expect(bounded.ok).toBe(true)
    expect(bounded.page.markdown).toBe(`${'x'.repeat(10)}… [truncated for storage: 50 chars in total]`)
    expect(retention.boundPersistedToolOutput(['y'.repeat(20)], 10)[0]).toStartWith('y'.repeat(10) + '…')
  })

  test('zero turns the cap off', () => {
    const big = {text: 'z'.repeat(100)}
    expect(retention.boundPersistedToolOutput(big, 0)).toBe(big)
  })
})

describe('journal entry compaction', () => {
  test('keeps the identity of an entry and previews its payload', () => {
    const entry = {kind: 'result', callSeq: 7, status: 'succeeded', output: {page: 'p'.repeat(40_000)}}
    const compacted = retention.compactJournalEntry(entry, 40_100, NOW)
    expect(compacted).toMatchObject({
      kind: 'result',
      callSeq: 7,
      status: 'succeeded',
      compacted: {at: NOW, bytes: 40_100},
    })
    expect(cbor.encode(compacted).byteLength).toBeLessThan(retention.JOURNAL_ENTRY_KEEP_BYTES)
    expect(JSON.stringify(compacted.output)).toContain('compacted by retention: 40000 chars')
  })

  test('many small strings that still add up are replaced by a preview object', () => {
    const entry = {
      kind: 'call',
      callSeq: 1,
      op: 'tool',
      tool: 'read',
      input: {rows: Array.from({length: 5_000}, () => 'abcd')},
    }
    const compacted = retention.compactJournalEntry(entry, 30_000, NOW)
    expect(compacted).toMatchObject({kind: 'call', callSeq: 1, tool: 'read', input: {compacted: true}})
    expect(cbor.encode(compacted).byteLength).toBeLessThan(retention.JOURNAL_ENTRY_KEEP_BYTES)
  })
})

describe('durable store retirement', () => {
  test('drops the stores of idle sessions only, and remembers where it got to', async () => {
    const db = openDb()
    addSession(db, 'old', NOW - 30 * DAY)
    addSession(db, 'recent', NOW - 2 * DAY)
    const tally = await retention.retireIdleDurableStores(db, policy(), control)
    expect(tally).toMatchObject({items: 1, rows: 2, bytes: 300})
    expect(storeRowCount(db, 'old')).toBe(0)
    expect(storeRowCount(db, 'recent')).toBe(2)
    // The transcript and the session itself stay.
    expect(db.query(`SELECT COUNT(*) AS n FROM sessions`).get()).toEqual({n: 2})

    // The next pass starts at the watermark, so the dropped session is not looked at again.
    const again = await retention.retireIdleDurableStores(db, policy(), control)
    expect(again.items).toBe(0)
  })

  test('leaves sessions with a live run or an open store, and comes back to them', async () => {
    const db = openDb()
    addSession(db, 'parked', NOW - 30 * DAY)
    addRun(db, 'run-parked', {status: 'waiting', createdAt: NOW - 30 * DAY, sessionId: 'parked'})
    addSession(db, 'open', NOW - 29 * DAY)
    const storage = await durableSession.openSessionStorage(db, 'open')
    try {
      expect(durableSession.isSessionStorageOpen(db, 'open')).toBe(true)
      const tally = await retention.retireIdleDurableStores(db, policy(), control)
      expect(tally).toMatchObject({items: 0, skipped: 2})
      expect(storeRowCount(db, 'parked')).toBe(2)
      expect(storeRowCount(db, 'open')).toBeGreaterThan(0)
    } finally {
      await storage.close(durableSession.CONTEXT)
    }
    db.run(`UPDATE runs SET status = 'succeeded', finished_at = ? WHERE id = 'run-parked'`, [NOW - 20 * DAY])
    const later = await retention.retireIdleDurableStores(db, policy(), control)
    expect(later.items).toBe(2)
    expect(storeRowCount(db, 'parked')).toBe(0)
    expect(storeRowCount(db, 'open')).toBe(0)
  })

  test('report mode removes nothing; stores over the size limit are deferred', async () => {
    const db = openDb()
    addSession(db, 'small', NOW - 30 * DAY)
    addSession(db, 'huge', NOW - 30 * DAY, [5_000])
    const reported = await retention.retireIdleDurableStores(db, policy({mode: 'report'}), control)
    expect(reported).toMatchObject({items: 2, bytes: 5_300})
    expect(storeRowCount(db, 'small')).toBe(2)

    const limited = await retention.retireIdleDurableStores(db, policy({maxStoreBytes: 1_000}), control)
    expect(limited).toMatchObject({items: 1, deferredBytes: 5_000})
    expect(storeRowCount(db, 'huge')).toBe(1)
  })

  test('zero idle time or mode off disables it', async () => {
    const db = openDb()
    addSession(db, 'old', NOW - 30 * DAY)
    expect((await retention.retireIdleDurableStores(db, policy({durableIdleMs: 0}), control)).items).toBe(0)
    expect((await retention.retireIdleDurableStores(db, policy({mode: 'off'}), control)).items).toBe(0)
    expect(storeRowCount(db, 'old')).toBe(2)
  })
})

describe('journal compaction', () => {
  const big = {kind: 'result', callSeq: 1, status: 'succeeded', output: {page: 'w'.repeat(64_000)}}
  const small = {kind: 'step', callSeq: 2, stepId: 's', label: 'Step', phase: 'end', ok: true}

  test('compacts the large entries of runs that finished long ago, and nothing else', async () => {
    const db = openDb()
    addRun(db, 'old-done', {status: 'succeeded', createdAt: NOW - 40 * DAY, finishedAt: NOW - 39 * DAY})
    addJournal(db, 'old-done', 1, big)
    addJournal(db, 'old-done', 2, small)
    addRun(db, 'old-live', {status: 'waiting', createdAt: NOW - 40 * DAY})
    addJournal(db, 'old-live', 1, big)
    addRun(db, 'recent-done', {status: 'failed', createdAt: NOW - 5 * DAY, finishedAt: NOW - 5 * DAY})
    addJournal(db, 'recent-done', 1, big)

    const tally = await retention.compactFinishedRunJournals(db, policy(), control)
    expect(tally.items).toBe(1)
    expect(tally.rows).toBe(1)
    expect(tally.bytes).toBeGreaterThan(60_000)

    const entries = (runId: string) =>
      db
        .query<{entry_cbor: Uint8Array}, [string]>(`SELECT entry_cbor FROM run_journal WHERE run_id = ? ORDER BY seq`)
        .all(runId)
        .map((row) => cbor.decode<Record<string, unknown>>(row.entry_cbor))
    const [first, second] = entries('old-done')
    expect(first).toMatchObject({kind: 'result', callSeq: 1, status: 'succeeded', compacted: {at: NOW}})
    expect(second).toEqual(small)
    expect(entries('old-live')[0]).toEqual(big)
    expect(entries('recent-done')[0]).toEqual(big)

    // A live run holds the watermark: once it finishes and ages, the next pass compacts it.
    db.run(`UPDATE runs SET status = 'canceled', finished_at = ? WHERE id = 'old-live'`, [NOW - 35 * DAY])
    const later = await retention.compactFinishedRunJournals(db, policy(), control)
    expect(later.items).toBe(1)
    expect(entries('old-live')[0]).toMatchObject({compacted: {at: NOW}})
  })

  test('report mode rewrites nothing', async () => {
    const db = openDb()
    addRun(db, 'old-done', {status: 'succeeded', createdAt: NOW - 40 * DAY, finishedAt: NOW - 39 * DAY})
    addJournal(db, 'old-done', 1, big)
    const tally = await retention.compactFinishedRunJournals(db, policy({mode: 'report'}), control)
    expect(tally.items).toBe(1)
    const row = db.query<{entry_cbor: Uint8Array}, []>(`SELECT entry_cbor FROM run_journal`).get()!
    expect(cbor.decode<unknown>(row.entry_cbor)).toEqual(big)
  })
})

describe('connection tuning', () => {
  test('applies cache, WAL limit and synchronous settings', () => {
    const db = new Database(':memory:', {create: true, strict: true})
    databases.push(db)
    sqlite.applyConnectionTuning(db, {cacheBytes: 128 * 1_048_576, mmapBytes: 0, walLimitBytes: 8 * 1_048_576})
    const settings = sqlite.connectionSettings(db)
    expect(settings.cacheSize).toBe(-131072)
    expect(settings.journalSizeLimit).toBe(8 * 1_048_576)
    expect(settings.synchronous).toBe(1)
  })
})

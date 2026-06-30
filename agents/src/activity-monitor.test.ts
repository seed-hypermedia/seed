import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import {ActivityMonitor} from '@/activity-monitor'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('activity monitor', () => {
  test('first poll processes events observed after trigger creation', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const processed: Array<Record<string, unknown>> = []
    const service = {
      processActivityEvent: async (_accountId: string, event: Record<string, unknown>) => {
        processed.push(event)
        return {checked: 1, matched: 1, fired: 1, skipped: 0, errors: 0}
      },
    } as apisvc.Service
    try {
      insertEnabledTrigger(db, dataDir, account, 1_000)
      const monitor = new ActivityMonitor(db, service, {
        hmServerUrl: 'https://hm.example',
        pollIntervalMs: 1000,
        pageSize: 10,
        maxPagesPerPoll: 1,
        client: {
          request: async () => ({events: [commentEvent('old', 999), commentEvent('new', 1_001)], nextPageToken: ''}),
        } as never,
      })
      await monitor.pollOnce()
      expect(processed).toHaveLength(1)
      expect(JSON.stringify(processed[0])).toContain('new')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('baselines first poll and processes only later events', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const service = {
      processActivityEvent: async (accountId: string, event: Record<string, unknown>) => {
        processed.push({accountId, event})
        return {checked: 1, matched: 1, fired: 1, skipped: 0, errors: 0}
      },
    } as apisvc.Service
    const processed: Array<{accountId: string; event: Record<string, unknown>}> = []
    const pages: Array<Record<string, unknown>[]> = [[commentEvent('old')], [commentEvent('new'), commentEvent('old')]]
    try {
      insertEnabledTrigger(db, dataDir, account, 1)

      const monitor = new ActivityMonitor(db, service, {
        hmServerUrl: 'https://hm.example',
        pollIntervalMs: 1000,
        pageSize: 10,
        maxPagesPerPoll: 1,
        client: {
          request: async () => ({events: pages.shift() || [], nextPageToken: ''}),
        } as never,
      })
      await monitor.pollOnce()
      expect(processed).toEqual([])
      await monitor.pollOnce()
      expect(processed).toHaveLength(1)
      expect(processed[0]?.accountId).toBe(account)
      expect(JSON.stringify(processed[0]?.event)).toContain('new')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('does not poll ActivityFeed for schedule-only triggers', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    let requestCount = 0
    const service = {
      processActivityEvent: async () => ({checked: 0, matched: 0, fired: 0, skipped: 0, errors: 0}),
    } as unknown as apisvc.Service
    try {
      insertEnabledTrigger(db, dataDir, account, 1, {
        type: 'schedule',
        schedule: {kind: 'interval', every: 1, unit: 'hours'},
      })
      const monitor = new ActivityMonitor(db, service, {
        hmServerUrl: 'https://hm.example',
        pollIntervalMs: 1000,
        pageSize: 10,
        maxPagesPerPoll: 1,
        client: {
          request: async () => {
            requestCount += 1
            return {events: [], nextPageToken: ''}
          },
        } as never,
      })
      await monitor.pollOnce()
      expect(requestCount).toBe(0)
    } finally {
      db.close()
      cleanup()
    }
  })

  test('processes every unseen event regardless of create time (no steady-state create-time cutoff)', async () => {
    // A comment can become visible to us long after it was authored (propagation/indexing lag, sometimes
    // extreme). Once we have a watermark, "new" is decided by whether we've already observed the event,
    // NOT by how old its timestamp is — so a late-propagating mention still fires.
    const {db, dataDir, cleanup} = createTestState()
    const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const processed: Array<Record<string, unknown>> = []
    const service = {
      processActivityEvent: async (_accountId: string, event: Record<string, unknown>) => {
        processed.push(event)
        return {checked: 1, matched: 1, fired: 1, skipped: 0, errors: 0}
      },
    } as apisvc.Service
    try {
      insertEnabledTrigger(db, dataDir, account, 1)
      db.run(
        `INSERT INTO activity_watermarks (account_id, server_url, cursor_cbor, last_poll_at, last_success_at)
         VALUES (?, ?, ?, ?, ?)`,
        [account, 'https://hm.example', cbor.encode({seenKeys: []}), 2_000, 2_000],
      )
      const recent = Date.now() - 1_000
      const monitor = new ActivityMonitor(db, service, {
        hmServerUrl: 'https://hm.example',
        pollIntervalMs: 1000,
        pageSize: 10,
        maxPagesPerPoll: 1,
        client: {
          request: async () => ({
            events: [commentEvent('recent', recent), commentEvent('ancient', recent - 2 * 60 * 60 * 1000)],
            nextPageToken: '',
          }),
        } as never,
      })

      await monitor.pollOnce()
      // Both are unseen, so both fire — the two-hour-old "ancient" event is no longer dropped.
      expect(processed).toHaveLength(2)
      const dump = JSON.stringify(processed)
      expect(dump).toContain('recent')
      expect(dump).toContain('ancient')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('processes an unseen event even when its create time predates the watermark', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const processed: Array<Record<string, unknown>> = []
    const service = {
      processActivityEvent: async (_accountId: string, event: Record<string, unknown>) => {
        processed.push(event)
        return {checked: 1, matched: 1, fired: 1, skipped: 0, errors: 0}
      },
    } as apisvc.Service
    try {
      insertEnabledTrigger(db, dataDir, account, 1)
      db.run(
        `INSERT INTO activity_watermarks (account_id, server_url, cursor_cbor, last_poll_at, last_success_at)
         VALUES (?, ?, ?, ?, ?)`,
        [account, 'https://hm.example', cbor.encode({seenKeys: []}), 2_000, 2_000],
      )
      const monitor = new ActivityMonitor(db, service, {
        hmServerUrl: 'https://hm.example',
        pollIntervalMs: 1000,
        pageSize: 10,
        maxPagesPerPoll: 1,
        client: {
          request: async () => ({events: [commentEvent('existing', 1_500)], nextPageToken: ''}),
        } as never,
      })

      await monitor.pollOnce()
      // Unseen key (seenKeys was empty) => processed, even though create time (1_500) is far in the past.
      expect(processed).toHaveLength(1)
      expect(JSON.stringify(processed[0])).toContain('existing')
      const watermark = db
        .query<{cursor_cbor: Uint8Array}, []>(`SELECT cursor_cbor FROM activity_watermarks LIMIT 1`)
        .get()
      expect(cbor.decode<{seenKeys: string[]}>(watermark!.cursor_cbor).seenKeys).toEqual(['blob-bafyexisting'])
    } finally {
      db.close()
      cleanup()
    }
  })
})

function insertEnabledTrigger(
  db: Database,
  dataDir: string,
  account: string,
  createdAt: number,
  source: Record<string, unknown> = {type: 'document-comment', resource: 'hm://z6Mkdoc'},
): void {
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, [account, createdAt, createdAt])
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'agent-1',
      account,
      cbor.encode({name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'}),
      dataDir,
      'idle',
      createdAt,
      createdAt,
    ],
  )
  db.run(
    `INSERT INTO agent_triggers (id, account_id, agent_id, name, enabled, source_cbor, prompt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['trigger-1', account, 'agent-1', 'Trigger', 1, cbor.encode(source), 'Prompt', createdAt, createdAt],
  )
}

function commentEvent(suffix: string, observeTime?: number): Record<string, unknown> {
  return {newBlob: {cid: `bafy${suffix}`, blobType: 'Comment', resource: 'hm://z6Mkdoc'}, observeTime}
}

function createTestState(): {db: Database; dataDir: string; cleanup: () => void} {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-monitor-test-'))
  return {
    db,
    dataDir,
    cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true}),
  }
}

import {Database, type SQLQueryBindings} from 'bun:sqlite'
import {mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import type {IngestEvent, LiveSummary, NormalizedEvent, RunRow} from './schema.js'
import {isRecord, normalizeEvent} from './schema.js'

export type Store = ReturnType<typeof openStore>

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true})
  const db = new Database(path, {create: true})
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      trigger TEXT,
      started_at TEXT,
      ended_at TEXT,
      status TEXT,
      wall_ms INTEGER,
      seed_site TEXT,
      km_account_id TEXT,
      counters_json TEXT,
      meta_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_key TEXT UNIQUE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      run_id TEXT,
      ts TEXT NOT NULL,
      event_name TEXT,
      level TEXT,
      comment_id TEXT,
      mention_id TEXT,
      actor_id TEXT,
      placeholder_id TEXT,
      state TEXT,
      status TEXT,
      preview TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS events_comment_id_idx ON events(comment_id, ts);
    CREATE INDEX IF NOT EXISTS events_run_id_idx ON events(run_id, ts);
    CREATE INDEX IF NOT EXISTS events_actor_id_idx ON events(actor_id, ts);
    CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind, ts);
    CREATE TABLE IF NOT EXISTS actors (
      actor_id TEXT PRIMARY KEY,
      run_id TEXT,
      mention_id TEXT,
      comment_id TEXT,
      state TEXT,
      status TEXT,
      alive INTEGER NOT NULL,
      snapshot_json TEXT,
      updated_at TEXT NOT NULL
    );
  `)

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (
      imported_key, source, kind, run_id, ts, event_name, level, comment_id, mention_id,
      actor_id, placeholder_id, state, status, preview, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const upsertRun = db.prepare(`
    INSERT INTO runs (
      run_id, trigger, started_at, ended_at, status, wall_ms, seed_site, km_account_id,
      counters_json, meta_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      trigger=excluded.trigger,
      started_at=COALESCE(excluded.started_at, runs.started_at),
      ended_at=COALESCE(excluded.ended_at, runs.ended_at),
      status=COALESCE(excluded.status, runs.status),
      wall_ms=COALESCE(excluded.wall_ms, runs.wall_ms),
      seed_site=COALESCE(excluded.seed_site, runs.seed_site),
      km_account_id=COALESCE(excluded.km_account_id, runs.km_account_id),
      counters_json=COALESCE(excluded.counters_json, runs.counters_json),
      meta_json=excluded.meta_json,
      updated_at=excluded.updated_at
  `)
  const upsertActor = db.prepare(`
    INSERT INTO actors (actor_id, run_id, mention_id, comment_id, state, status, alive, snapshot_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_id) DO UPDATE SET
      run_id=COALESCE(excluded.run_id, actors.run_id),
      mention_id=COALESCE(excluded.mention_id, actors.mention_id),
      comment_id=COALESCE(excluded.comment_id, actors.comment_id),
      state=COALESCE(excluded.state, actors.state),
      status=COALESCE(excluded.status, actors.status),
      alive=excluded.alive,
      snapshot_json=excluded.snapshot_json,
      updated_at=excluded.updated_at
  `)

  function record(event: IngestEvent): NormalizedEvent {
    const normalized = normalizeEvent(event)
    const payloadJson = JSON.stringify(normalized.payload)
    insertEvent.run(
      normalized.importedKey,
      normalized.source,
      normalized.kind,
      normalized.runId,
      normalized.ts,
      normalized.eventName,
      normalized.level,
      normalized.commentId,
      normalized.mentionId,
      normalized.actorId,
      normalized.placeholderId,
      normalized.state,
      normalized.status,
      normalized.preview,
      payloadJson,
    )
    if (normalized.kind === 'run_meta') upsertRunFromPayload(normalized)
    if (normalized.kind === 'machine_event' || normalized.kind === 'machine_snapshot') upsertActorFromPayload(normalized)
    return normalized
  }

  function upsertRunFromPayload(event: NormalizedEvent): void {
    if (!event.runId || !isRecord(event.payload)) return
    const meta = event.payload
    const counters = meta.counters ? JSON.stringify(meta.counters) : null
    upsertRun.run(
      event.runId,
      stringValue(meta.trigger),
      stringValue(meta.startedAt) ?? stringValue(meta.start),
      stringValue(meta.endedAt) ?? stringValue(meta.end),
      stringValue(meta.status),
      numberValue(meta.wallMs) ?? numberValue(meta.wall_ms),
      stringValue(meta.seedSite),
      stringValue(meta.kmAccountId),
      counters,
      JSON.stringify(meta),
      new Date().toISOString(),
    )
  }

  function upsertActorFromPayload(event: NormalizedEvent): void {
    const actorId = event.actorId ?? event.mentionId
    if (!actorId) return
    const eventName = event.eventName ?? ''
    const done = event.status === 'done' || eventName === 'actor_stopped' || eventName === 'done'
    const alive = done ? 0 : 1
    upsertActor.run(
      actorId,
      event.runId,
      event.mentionId,
      event.commentId,
      event.state,
      event.status,
      alive,
      JSON.stringify(event.payload),
      event.ts,
    )
  }

  function listRuns(limit = 50): RunRow[] {
    return db
      .query(`
        SELECT run_id as runId, trigger, started_at as startedAt, ended_at as endedAt, status,
               wall_ms as wallMs, seed_site as seedSite, km_account_id as kmAccountId,
               counters_json as countersJson
        FROM runs ORDER BY COALESCE(started_at, updated_at) DESC LIMIT ?
      `)
      .all(limit) as RunRow[]
  }

  function listEvents(opts: {limit?: number; commentId?: string; runId?: string; actorId?: string} = {}) {
    const limit = opts.limit ?? 200
    const where: string[] = []
    const args: SQLQueryBindings[] = []
    if (opts.commentId) {
      where.push('comment_id = ?')
      args.push(opts.commentId)
    }
    if (opts.runId) {
      where.push('run_id = ?')
      args.push(opts.runId)
    }
    if (opts.actorId) {
      where.push('actor_id = ?')
      args.push(opts.actorId)
    }
    const sql = `
      SELECT id, source, kind, run_id as runId, ts, event_name as eventName, level,
             comment_id as commentId, mention_id as mentionId, actor_id as actorId,
             placeholder_id as placeholderId, state, status, preview, payload_json as payloadJson
      FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ts DESC, id DESC LIMIT ?
    `
    return db.query(sql).all(...args, limit) as Array<Record<string, unknown>>
  }

  function commentTimeline(commentId: string) {
    return listEvents({commentId, limit: 500}).reverse()
  }

  function liveSummary(): LiveSummary {
    const alive = db.query('SELECT COUNT(*) as count FROM actors WHERE alive = 1').get() as {count: number}
    const active = db.query("SELECT COUNT(*) as count FROM runs WHERE ended_at IS NULL OR status IS NULL").get() as {count: number}
    return {
      aliveActors: alive.count,
      activeRuns: active.count,
      latestEvents: listEvents({limit: 30}),
      updatedAt: new Date().toISOString(),
    }
  }

  return {db, record, listRuns, listEvents, commentTimeline, liveSummary}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as sqlite from './sqlite.ts'

describe('sqlite', () => {
  test('fresh init writes schema_migration_version and core tables', () => {
    const db = createMemoryDatabase()
    try {
      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
      expect(tableExists(db, 'agents')).toBe(true)
      expect(tableExists(db, 'agent_collaborators')).toBe(true)
      expect(tableExists(db, 'session_events')).toBe(true)
      expect(tableExists(db, 'action_idempotency')).toBe(true)
      expect(tableExists(db, 'agent_triggers')).toBe(true)
      expect(tableExists(db, 'trigger_firings')).toBe(true)
      expect(tableExists(db, 'webhook_trigger_credentials')).toBe(true)
      expect(columnExists(db, 'trigger_firings', 'body_digest')).toBe(true)
      expect(columnExists(db, 'trigger_firings', 'run_id')).toBe(true)
      expect(tableExists(db, 'activity_watermarks')).toBe(true)
      expect(tableExists(db, 'runs')).toBe(true)
      expect(tableExists(db, 'run_journal')).toBe(true)
      expect(tableExists(db, 'tool_documents')).toBe(true)
      expect(tableExists(db, 'mcp_servers')).toBe(true)
      expect(columnExists(db, 'sessions', 'title_source')).toBe(true)
      expect(columnExists(db, 'sessions', 'model_override_cbor')).toBe(true)
      expect(columnExists(db, 'sessions', 'description')).toBe(true)
      expect(columnExists(db, 'sessions', 'parent_session_id')).toBe(true)
      // A fresh database is built from the baseline file alone, so every column a migration adds
      // must also be in that file — this is the assertion that catches the two drifting apart.
      expect(columnExists(db, 'runs', 'parent_tool_call_id')).toBe(true)
      expect(columnExists(db, 'runs', 'continued_from_run_id')).toBe(true)
      expect(tableExists(db, 'run_event_waits')).toBe(true)
      expect(columnExists(db, 'agent_triggers', 'continuation_cbor')).toBe(true)
      expect(indexExists(db, 'runs_by_agent_status')).toBe(true)
      expect(indexExists(db, 'runs_live')).toBe(true)
      expect(indexExists(db, 'sessions_top_by_account_agent')).toBe(true)
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('rejects non-empty databases without server_config', () => {
    const db = createMemoryDatabase()
    try {
      db.run(`CREATE TABLE unexpected_state (id INTEGER PRIMARY KEY)`)
      expect(sqlite.openWithDatabase(db)).toEqual({
        ok: false,
        current: sqlite.BASELINE_SCHEMA_MIGRATION_VERSION,
        desired: sqlite.desiredVersion,
      })
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('applies pending migrations from baseline version', () => {
    const db = createMemoryDatabase()
    try {
      db.run(
        sqlite.schema
          .replace(/CREATE TABLE agent_id_aliases[\s\S]*?CREATE INDEX agent_id_aliases_by_agent[^\n]*\n\n/u, '')
          .replace(/    title_source TEXT NOT NULL DEFAULT 'system',\n/u, '')
          .replace(/    model_override_cbor BLOB,\n/u, '')
          .replace(/    description TEXT,\n/u, '')
          .replace(
            /    parent_session_id TEXT REFERENCES sessions \(id\),\n    run_id TEXT,\n    plan_cbor BLOB,\n/u,
            '',
          )
          .replace(/CREATE INDEX sessions_by_parent ON sessions \(parent_session_id, created_at\);\n\n/u, '')
          .replace(/CREATE INDEX sessions_top_by_\w+ ON sessions \([^)]*\);\n+/gu, '')
          .replace(/-- A continuation edge[\s\S]*?CREATE TABLE trigger_firings/u, 'CREATE TABLE trigger_firings')
          .replace(/    capability_cid TEXT,\n/u, '')
          .replace(/    public_read INTEGER NOT NULL DEFAULT 0,\n/u, '')
          .replace(/    public_chat INTEGER NOT NULL DEFAULT 0,\n/u, '')
          .replace(
            /CREATE TABLE agent_collaborators[\s\S]*?CREATE TABLE agent_triggers/u,
            'CREATE TABLE agent_triggers',
          )
          .replace(/CREATE TABLE runs[\s\S]*?CREATE TABLE agent_drafts/u, 'CREATE TABLE agent_drafts')
          .replace(/CREATE TABLE tool_documents[\s\S]*?CREATE TABLE server_config/u, 'CREATE TABLE server_config')
          .replace(/CREATE TABLE mcp_servers[\s\S]*?CREATE TABLE agents/u, 'CREATE TABLE agents')
          .replace(/CREATE TABLE agent_triggers[\s\S]*?CREATE TABLE sessions/u, 'CREATE TABLE sessions')
          .replace(/CREATE TABLE trigger_firings[\s\S]*?CREATE TABLE session_events/u, 'CREATE TABLE session_events')
          .replace(
            /CREATE TABLE agent_drafts[\s\S]*?CREATE TABLE action_idempotency/u,
            'CREATE TABLE action_idempotency',
          )
          .replace(/CREATE TABLE action_idempotency[\s\S]*?\) WITHOUT ROWID;\n\n/u, ''),
      )
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(sqlite.BASELINE_SCHEMA_MIGRATION_VERSION),
      ])
      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(tableExists(db, 'action_idempotency')).toBe(true)
      expect(tableExists(db, 'agent_triggers')).toBe(true)
      expect(tableExists(db, 'trigger_firings')).toBe(true)
      expect(tableExists(db, 'webhook_trigger_credentials')).toBe(true)
      expect(tableExists(db, 'session_continuations')).toBe(true)
      expect(columnExists(db, 'trigger_firings', 'body_digest')).toBe(true)
      expect(columnExists(db, 'trigger_firings', 'run_id')).toBe(true)
      expect(tableExists(db, 'activity_watermarks')).toBe(true)
      expect(tableExists(db, 'agent_drafts')).toBe(true)
      expect(tableExists(db, 'agent_collaborators')).toBe(true)
      expect(tableExists(db, 'runs')).toBe(true)
      expect(tableExists(db, 'run_journal')).toBe(true)
      expect(tableExists(db, 'tool_documents')).toBe(true)
      expect(tableExists(db, 'app_usage')).toBe(true)
      expect(columnExists(db, 'app_mounts', 'usage_cbor')).toBe(true)
      expect(tableExists(db, 'app_mounts')).toBe(true)
      expect(tableExists(db, 'server_bindings')).toBe(true)
      expect(tableExists(db, 'mcp_servers')).toBe(true)
      expect(columnExists(db, 'mcp_servers', 'tools_cbor')).toBe(true)
      expect(columnExists(db, 'agent_triggers', 'cooldown_ms')).toBe(true)
      expect(columnExists(db, 'agents', 'public_read')).toBe(true)
      expect(columnExists(db, 'agents', 'public_chat')).toBe(true)
      expect(columnExists(db, 'sessions', 'title_source')).toBe(true)
      expect(columnExists(db, 'sessions', 'model_override_cbor')).toBe(true)
      expect(columnExists(db, 'sessions', 'parent_session_id')).toBe(true)
      expect(columnExists(db, 'sessions', 'run_id')).toBe(true)
      expect(columnExists(db, 'sessions', 'plan_cbor')).toBe(true)
      expect(columnExists(db, 'runs', 'parent_tool_call_id')).toBe(true)
      expect(columnExists(db, 'runs', 'continued_from_run_id')).toBe(true)
      expect(tableExists(db, 'run_event_waits')).toBe(true)
      expect(columnExists(db, 'agent_triggers', 'continuation_cbor')).toBe(true)
      expect(indexExists(db, 'runs_by_agent_status')).toBe(true)
      expect(indexExists(db, 'runs_live')).toBe(true)
      expect(indexExists(db, 'sessions_top_by_account_agent')).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('a database behind the firing-session migration links workflow sessions to their firing', () => {
    // Before this migration a headless (script/tool) trigger's workflow spawned child sessions that
    // nothing tied back to the firing: no parent session, and the firing's session_id stayed null.
    const db = createMemoryDatabase()
    try {
      db.run(sqlite.schema)
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(
          sqlite.desiredVersion -
            sqlite.migrations.findIndex((migration) => migration.includes('UPDATE trigger_firings SET session_id')) -
            1,
        ),
      ])
      const now = 1_700_000_000_000
      db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES ('acct', ?, ?)`, [now, now])
      db.run(
        `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
         VALUES ('agent', 'acct', X'A0', '/tmp/agent', 'idle', ?, ?)`,
        [now, now],
      )
      db.run(
        `INSERT INTO agent_triggers (id, account_id, agent_id, name, enabled, source_cbor, prompt, created_at, updated_at)
         VALUES ('trig', 'acct', 'agent', 'GitHub', 1, X'A0', '', ?, ?)`,
        [now, now],
      )
      for (const id of ['s-first', 's-second', 's-chat', 's-chat-child']) {
        db.run(
          `INSERT INTO sessions (id, account_id, agent_id, status, created_at, updated_at) VALUES (?, 'acct', 'agent', 'idle', ?, ?)`,
          [id, now, now],
        )
      }
      // Firing → headless workflow root (no session) → two agent children, each with its own session.
      db.run(
        `INSERT INTO trigger_firings (id, account_id, agent_id, trigger_id, activity_key, activity_cbor, run_id, status, created_at)
         VALUES ('f1', 'acct', 'agent', 'trig', 'webhook:d1', X'A0', 'firing-f1', 'succeeded', ?)`,
        [now],
      )
      const insertRun = (
        id: string,
        parent: string | null,
        kind: string,
        session: string | null,
        firing: string | null,
        at: number,
      ) =>
        db.run(
          `INSERT INTO runs (id, account_id, root_run_id, parent_run_id, kind, agent_id, session_id, trigger_firing_id, origin, input_cbor, status, created_at, updated_at)
           VALUES (?, 'acct', ?, ?, ?, 'agent', ?, ?, 'workflow', X'A0', 'succeeded', ?, ?)`,
          [id, parent ? parent : id, parent, kind, session, firing, at, at],
        )
      insertRun('firing-f1', null, 'workflow', null, 'f1', now)
      insertRun('child-1', 'firing-f1', 'agent', 's-first', null, now + 1)
      insertRun('child-2', 'firing-f1', 'agent', 's-second', null, now + 2)
      // A workflow launched from a chat already nests its child under that chat; it must not change.
      insertRun('wf-chat', null, 'workflow', 's-chat', null, now)
      insertRun('child-chat', 'wf-chat', 'agent', 's-chat-child', null, now + 1)
      db.run(`UPDATE sessions SET parent_session_id = 's-chat' WHERE id = 's-chat-child'`)

      expect(sqlite.openWithDatabase(db).ok).toBe(true)
      const firing = db
        .query<{session_id: string | null}, []>(`SELECT session_id FROM trigger_firings WHERE id = 'f1'`)
        .get()
      expect(firing?.session_id).toBe('s-first')
      const parents = db
        .query<{id: string; parent_session_id: string | null}, []>(
          `SELECT id, parent_session_id FROM sessions ORDER BY id`,
        )
        .all()
      expect(parents).toEqual([
        {id: 's-chat', parent_session_id: null},
        {id: 's-chat-child', parent_session_id: 's-chat'},
        {id: 's-first', parent_session_id: null},
        {id: 's-second', parent_session_id: 's-first'},
      ])
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('a database behind the trigger-claims migration gains its claims and history fields', () => {
    // Start immediately before this migration, independent of newer prepended migrations.
    const db = createMemoryDatabase()
    try {
      db.run(
        sqlite.schema
          .replace(/    merged_into TEXT,\n/u, '')
          .replace(/    context_cbor BLOB,\n/u, '')
          .replace(/CREATE TABLE trigger_event_claims[\s\S]*?\) WITHOUT ROWID;/u, ''),
      )
      expect(columnExists(db, 'agent_triggers', 'merged_into')).toBe(false)
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(
          sqlite.desiredVersion -
            sqlite.migrations.findIndex((migration) =>
              migration.includes('ALTER TABLE agent_triggers ADD COLUMN merged_into'),
            ) -
            1,
        ),
      ])
      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(columnExists(db, 'agent_triggers', 'merged_into')).toBe(true)
      expect(columnExists(db, 'trigger_firings', 'context_cbor')).toBe(true)
      expect(tableExists(db, 'trigger_event_claims')).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('recreates baseline tables missing despite an up-to-date migration version', () => {
    // The migration version is only a count, so a database migrated on a feature branch whose Nth
    // migration differs from main's Nth carries the right number with the wrong schema. This is
    // exactly the state that broke a dev database: version = desiredVersion, no mcp_servers table,
    // plus a leftover table main never defined.
    const db = createMemoryDatabase()
    try {
      db.run(sqlite.schema)
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(sqlite.desiredVersion),
      ])
      db.run(`DROP TABLE mcp_servers`)
      db.run(`CREATE TABLE from_another_branch (id TEXT PRIMARY KEY) WITHOUT ROWID`)

      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(tableExists(db, 'mcp_servers')).toBe(true)
      expect(columnExists(db, 'mcp_servers', 'tools_cbor')).toBe(true)
      expect(
        db.query(`SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'mcp_servers_by_account'`).get(),
      ).not.toBeNull()
      // Tables a divergent branch added are left alone.
      expect(tableExists(db, 'from_another_branch')).toBe(true)
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('self-heals a stale migration version whose objects already exist, still applying what is missing', () => {
    // The inverse of the missing-table repair: a database migrated under a divergent branch
    // ordering already holds most pending migrations' objects while the count claims they are all
    // pending. This is exactly the state that crash-looped a dev database on boot ("table
    // webhook_trigger_credentials already exists") — and that database also genuinely lacked
    // trigger_firings.run_id, so skipping whole migrations would trade the crash for "no such
    // column". Statement-wise replay must skip only what exists and apply the rest.
    const db = createMemoryDatabase()
    try {
      db.run(sqlite.schema.replace(/    context_cbor BLOB,\n    run_id TEXT,\n/u, '    context_cbor BLOB,\n'))
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(sqlite.BASELINE_SCHEMA_MIGRATION_VERSION),
      ])
      expect(columnExists(db, 'trigger_firings', 'run_id')).toBe(false)

      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
      // The genuinely missing piece of a partially-present migration was still applied.
      expect(columnExists(db, 'trigger_firings', 'run_id')).toBe(true)
      expect(tableExists(db, 'webhook_trigger_credentials')).toBe(true)
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('rejects databases with missing, legacy, invalid, or future migration versions', () => {
    const cases: Array<{name: string; setup: (db: Database) => void; current: number}> = [
      {
        name: 'missing migration key',
        setup: (db) => db.run(sqlite.schema),
        current: sqlite.BASELINE_SCHEMA_MIGRATION_VERSION,
      },
      {
        name: 'legacy schema_version marker',
        setup: (db) => {
          db.run(sqlite.schema)
          db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [sqlite.LEGACY_SCHEMA_VERSION_KEY, '7'])
        },
        current: 7,
      },
      {
        name: 'invalid current version',
        setup: (db) => {
          db.run(sqlite.schema)
          db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
            sqlite.SCHEMA_MIGRATION_VERSION_KEY,
            'not-a-number',
          ])
        },
        current: sqlite.BASELINE_SCHEMA_MIGRATION_VERSION,
      },
      {
        name: 'future current version',
        setup: (db) => {
          db.run(sqlite.schema)
          db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
            sqlite.SCHEMA_MIGRATION_VERSION_KEY,
            String(sqlite.desiredVersion + 1),
          ])
        },
        current: sqlite.desiredVersion + 1,
      },
    ]

    for (const testCase of cases) {
      const db = createMemoryDatabase()
      try {
        testCase.setup(db)
        expect(sqlite.openWithDatabase(db), testCase.name).toEqual({
          ok: false,
          current: testCase.current,
          desired: sqlite.desiredVersion,
        })
      } finally {
        sqlite.closeDatabase(db)
      }
    }
  })

  test('stripSQLComments removes comments without touching literals', () => {
    expect(
      sqlite.stripSQLComments(`
        CREATE TABLE demo (
          id TEXT PRIMARY KEY, -- inline comment
          value TEXT NOT NULL DEFAULT '--not-comment'
        );
        /* block comment */
        CREATE INDEX demo_by_value ON demo (value);
      `),
    ).toBe(
      [
        '        CREATE TABLE demo (',
        '          id TEXT PRIMARY KEY,',
        "          value TEXT NOT NULL DEFAULT '--not-comment'",
        '        );',
        '',
        '        CREATE INDEX demo_by_value ON demo (value);',
      ].join('\n'),
    )
  })
})
describe('live-run and session-count query plans on production-shaped statistics', () => {
  // sqlite_stat1 keeps one average per index prefix. On production `status` has a handful of
  // values over every run ever made (so "rows per status" is tens of thousands, though `waiting`
  // is a few dozen), and `not_before` is NULL for nearly every row but distinct where set (so
  // "rows per not_before" is tiny). From those averages the planner preferred a skip-scan of
  // runs_dispatch that drops the status equality: the boot's waiting-runs select took 67 s on the
  // 46 GB file (2026-11-10). These figures reproduce that choice.
  const PROD_SHAPED_STATS: Array<[string, string]> = [
    ['runs', '500000 1'],
    ['runs_dispatch', '500000 71429 35715 2 1'],
    ['runs_by_agent_status', '500000 50000 5000'],
    ['runs_by_account', '500000 25000 1'],
    ['runs_by_session', '500000 3 1'],
    ['runs_by_root', '500000 4 1'],
    ['runs_by_parent', '500000 400000'],
    ['runs_live', '72 18 2 1'],
  ]

  function planFor(db: Database, sql: string): string {
    return db
      .query<{detail: string}, []>(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => row.detail)
      .join(' | ')
  }

  function withProdStats(db: Database, stats: Array<[string, string]>): void {
    db.run(`DELETE FROM sqlite_stat1 WHERE tbl = 'runs'`)
    for (const [idx, stat] of stats) {
      db.run(`INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('runs', ?, ?)`, [idx, stat])
    }
    db.run(`DELETE FROM sqlite_stat1 WHERE tbl = 'sessions'`)
    for (const [idx, stat] of [
      ['sessions', '22600 1'],
      ['sessions_by_agent', '22600 400 1'],
      ['sessions_by_parent', '22600 2 1'],
      ['sessions_top_by_agent', '22600 400 300 1 1'],
      ['sessions_top_by_time', '22600 5 1 1'],
      ['sessions_top_by_account_agent', '22600 1000 300 250'],
    ] as const) {
      db.run(`INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('sessions', ?, ?)`, [idx, stat])
    }
    // Reloads the statistics into the planner.
    db.run('ANALYZE sqlite_schema')
  }

  const WAITING_SELECT = `SELECT id, account_id FROM runs WHERE status = 'waiting' AND not_before IS NULL`

  test('without runs_live the waiting-runs select skip-scans runs_dispatch (the 2026-11-10 boot)', () => {
    const db = createMemoryDatabase()
    try {
      expect(sqlite.openWithDatabase(db).ok).toBe(true)
      db.run('DROP INDEX runs_live')
      withProdStats(
        db,
        PROD_SHAPED_STATS.filter(([idx]) => idx !== 'runs_live'),
      )
      expect(planFor(db, WAITING_SELECT)).toContain('ANY(status)')
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('the boot, sweep and dispatch-tick lookups on a live status all seek runs_live', () => {
    const db = createMemoryDatabase()
    try {
      expect(sqlite.openWithDatabase(db).ok).toBe(true)
      withProdStats(db, PROD_SHAPED_STATS)
      // The boot reconcile's id list comes from the index alone.
      expect(planFor(db, WAITING_SELECT)).toBe('SEARCH runs USING COVERING INDEX runs_live (status=? AND not_before=?)')
      for (const sql of [
        // RunQueue.sweepAtBoot
        `UPDATE runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = 1
           WHERE status = 'claimed' OR status = 'running' RETURNING id`,
        // RunQueue.#wakeDueTimers, every dispatch tick
        `UPDATE runs SET status = 'queued', wait_cbor = NULL, not_before = NULL, updated_at = 1
           WHERE status = 'waiting' AND not_before IS NOT NULL AND not_before <= 1 RETURNING id`,
        // RunQueue.#hasFutureWork
        `SELECT id FROM runs WHERE status = 'queued' OR (status = 'waiting' AND not_before IS NOT NULL) LIMIT 1`,
        // RunQueue.#hasDispatchableWork
        `SELECT id FROM runs WHERE status = 'queued' AND (not_before IS NULL OR not_before <= 1) LIMIT 1`,
      ]) {
        const plan = planFor(db, sql)
        expect(plan).toContain('runs_live')
        expect(plan).not.toContain('ANY(')
      }
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test("GetAgent's top-level session count is answered from sessions_top_by_account_agent alone", () => {
    const db = createMemoryDatabase()
    try {
      expect(sqlite.openWithDatabase(db).ok).toBe(true)
      withProdStats(db, PROD_SHAPED_STATS)
      expect(
        planFor(
          db,
          `SELECT COUNT(*) AS n FROM sessions WHERE account_id = 'a' AND agent_id = 'b' AND parent_session_id IS NULL`,
        ),
      ).toBe(
        'SEARCH sessions USING COVERING INDEX sessions_top_by_account_agent (account_id=? AND agent_id=? AND parent_session_id=?)',
      )
    } finally {
      sqlite.closeDatabase(db)
    }
  })
})

function createMemoryDatabase(): Database {
  return new Database(':memory:', {create: true, strict: true})
}

function getConfigValue(db: Database, key: string): string | null {
  const row = db.query<{value: string}, [string]>(`SELECT value FROM server_config WHERE key = ?`).get(key)
  return row?.value ?? null
}

function tableExists(db: Database, name: string): boolean {
  return db.query(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1`).get(name) !== null
}

function indexExists(db: Database, name: string): boolean {
  return db.query(`SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ? LIMIT 1`).get(name) !== null
}

function columnExists(db: Database, table: string, column: string): boolean {
  return db.query(`SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1`).get(table, column) !== null
}

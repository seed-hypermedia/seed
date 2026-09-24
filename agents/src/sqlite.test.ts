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
          .replace(/    title_source TEXT NOT NULL DEFAULT 'system',\n/u, '')
          .replace(/    model_override_cbor BLOB,\n/u, '')
          .replace(/    description TEXT,\n/u, '')
          .replace(
            /    parent_session_id TEXT REFERENCES sessions \(id\),\n    run_id TEXT,\n    plan_cbor BLOB,\n/u,
            '',
          )
          .replace(/CREATE INDEX sessions_by_parent ON sessions \(parent_session_id, created_at\);\n\n/u, '')
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
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('a database one migration behind links trigger-launched workflow sessions to their firing', () => {
    // Before this migration a headless (script/tool) trigger's workflow spawned child sessions that
    // nothing tied back to the firing: no parent session, and the firing's session_id stayed null.
    const db = createMemoryDatabase()
    try {
      db.run(sqlite.schema)
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(sqlite.desiredVersion - 1),
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
    // The array is prepend-only and reversed on apply, so the newest migration must sit at the
    // top: placed lower, a deployed database would replay an older migration (tolerated as
    // "already exists") and never receive the new column. The claims migration is second from the
    // top (the firing-session link migration sits above it), so start two versions behind.
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
        String(sqlite.desiredVersion - 2),
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

function columnExists(db: Database, table: string, column: string): boolean {
  return db.query(`SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1`).get(table, column) !== null
}

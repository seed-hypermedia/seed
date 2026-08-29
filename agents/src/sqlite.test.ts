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
      db.close()
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
      db.close()
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
      db.close()
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
      db.close()
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
        db.close()
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

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
      expect(tableExists(db, 'session_events')).toBe(true)
      expect(tableExists(db, 'action_idempotency')).toBe(true)
      expect(tableExists(db, 'agent_triggers')).toBe(true)
      expect(tableExists(db, 'trigger_firings')).toBe(true)
      expect(tableExists(db, 'activity_watermarks')).toBe(true)
      expect(columnExists(db, 'sessions', 'title_source')).toBe(true)
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
      expect(columnExists(db, 'agent_triggers', 'cooldown_ms')).toBe(true)
      expect(columnExists(db, 'sessions', 'title_source')).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
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

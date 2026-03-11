import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import baselineSchemaSQL from './testdata/schema.v0.sql' with {type: 'text'}
import * as sqlite from './sqlite.ts'

type TableListRow = {
  name: string
  ncol: number
  wr: number
  strict: number
  type: string
}

type TableColumnRow = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
  hidden: number
}

type ForeignKeyRow = {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

type IndexListRow = {
  name: string
  unique: number
  origin: string
  partial: number
}

type IndexColumnRow = {
  seqno: number
  cid: number
  name: string | null
  desc: number
  coll: string
  key: number
}

describe('sqlite', () => {
  test('stripSQLComments removes comment-only lines and trailing comment whitespace', () => {
    expect(
      sqlite.stripSQLComments(`
        CREATE TABLE demo (
          id TEXT PRIMARY KEY, -- inline comment
          /* block comment */
          value TEXT NOT NULL
        );

        -- comment-only separator

        CREATE INDEX demo_by_value ON demo (value);
      `),
    ).toBe(
      [
        '        CREATE TABLE demo (',
        '          id TEXT PRIMARY KEY,',
        '          value TEXT NOT NULL',
        '        );',
        '',
        '        CREATE INDEX demo_by_value ON demo (value);',
      ].join('\n'),
    )
  })

  test('fresh init writes schema_migration_version', () => {
    const db = createMemoryDatabase()
    try {
      const result = sqlite.openWithDatabase(db)
      expect(result.ok).toBe(true)
      expect(getConfigValue(db, sqlite.SCHEMA_MIGRATION_VERSION_KEY)).toBe(String(sqlite.desiredVersion))
    } finally {
      db.close()
    }
  })

  test('rejects databases that still contain the legacy schema_version marker', () => {
    const db = createMemoryDatabase()
    try {
      db.run(sqlite.schema)
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [sqlite.SCHEMA_MIGRATION_VERSION_KEY, '0'])
      db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [sqlite.LEGACY_SCHEMA_VERSION_KEY, '6'])

      expect(sqlite.openWithDatabase(db)).toEqual({
        ok: false,
        current: 6,
        desired: sqlite.desiredVersion,
      })
    } finally {
      db.close()
    }
  })

  test('rejects non-empty databases without schema_migration_version', () => {
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

  test('drift test matches fresh desired schema and migrated baseline schema structurally', () => {
    expect(baselineSchemaSQL).not.toMatch(/--|\/\*/u)

    const desiredDb = createMemoryDatabase()
    const baselineDb = createMemoryDatabase()

    try {
      const desiredResult = sqlite.openWithDatabase(desiredDb)
      expect(desiredResult.ok).toBe(true)

      baselineDb.run(baselineSchemaSQL)
      baselineDb.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [
        sqlite.SCHEMA_MIGRATION_VERSION_KEY,
        String(sqlite.BASELINE_SCHEMA_MIGRATION_VERSION),
      ])

      const migratedResult = sqlite.openWithDatabase(baselineDb)
      expect(migratedResult.ok).toBe(true)

      expectDatabaseStructureMatches(describeDatabaseStructure(baselineDb), describeDatabaseStructure(desiredDb))
    } finally {
      baselineDb.close()
      desiredDb.close()
    }
  })

  test('getOrCreateHmacSecret', () => {
    const db = createInitializedMemoryDatabase()
    try {
      const secret1 = sqlite.getOrCreateHmacSecret(db)
      expect(secret1).toBeInstanceOf(Uint8Array)
      expect(secret1.length).toBe(32)

      const secret2 = sqlite.getOrCreateHmacSecret(db)
      expect(secret2).toEqual(secret1)

      const row = db.query("SELECT value FROM server_config WHERE key = 'hmac_secret'").get() as {value: Uint8Array}
      expect(row.value).toEqual(secret1)
    } finally {
      db.close()
    }
  })
})

function createMemoryDatabase(): Database {
  return new Database(':memory:', {create: true, strict: true})
}

function createInitializedMemoryDatabase(): Database {
  const db = createMemoryDatabase()
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) {
    db.close()
    throw new Error(`unexpected schema mismatch ${result.current} !== ${result.desired}`)
  }
  return db
}

function getConfigValue(db: Database, key: string): string | null {
  const row = db.query<{value: string}, [string]>(`SELECT value FROM server_config WHERE key = ?`).get(key)
  return row?.value ?? null
}

function describeDatabaseStructure(db: Database) {
  const tables = db
    .query<TableListRow, []>(`PRAGMA table_list`)
    .all()
    .filter((table) => table.type === 'table' && !table.name.startsWith('sqlite_'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((table) => ({
      name: table.name,
      columnCount: table.ncol,
      withoutRowId: table.wr,
      strict: table.strict,
      columns: db
        .query<TableColumnRow, []>(`PRAGMA table_xinfo(${quoteIdentifier(table.name)})`)
        .all()
        .sort((left, right) => left.cid - right.cid)
        .map((column) => ({
          cid: column.cid,
          name: column.name,
          type: column.type,
          notnull: column.notnull,
          defaultValue: column.dflt_value,
          primaryKeyPosition: column.pk,
          hidden: column.hidden,
        })),
      foreignKeys: db
        .query<ForeignKeyRow, []>(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`)
        .all()
        .sort((left, right) => left.id - right.id || left.seq - right.seq)
        .map((foreignKey) => ({
          id: foreignKey.id,
          seq: foreignKey.seq,
          table: foreignKey.table,
          from: foreignKey.from,
          to: foreignKey.to,
          onUpdate: foreignKey.on_update,
          onDelete: foreignKey.on_delete,
          match: foreignKey.match,
        })),
    }))

  const indexes = tables
    .flatMap((table) =>
      db
        .query<IndexListRow, []>(`PRAGMA index_list(${quoteIdentifier(table.name)})`)
        .all()
        .filter((index) => !index.name.startsWith('sqlite_'))
        .map((index) => ({
          name: index.name,
          tableName: table.name,
          unique: index.unique,
          origin: index.origin,
          partial: index.partial,
          columns: db
            .query<IndexColumnRow, []>(`PRAGMA index_xinfo(${quoteIdentifier(index.name)})`)
            .all()
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => ({
              seqno: column.seqno,
              cid: column.cid,
              name: column.name,
              desc: column.desc,
              coll: column.coll,
              key: column.key,
            })),
        })),
    )
    .sort((left, right) => left.name.localeCompare(right.name))

  return {tables, indexes}
}

type DatabaseStructure = ReturnType<typeof describeDatabaseStructure>

function expectDatabaseStructureMatches(actual: DatabaseStructure, expected: DatabaseStructure): void {
  expectNamedEntriesToMatch('table', actual.tables, expected.tables)
  expectNamedEntriesToMatch('index', actual.indexes, expected.indexes)
}

function expectNamedEntriesToMatch<Entry extends {name: string}>(
  kind: 'table' | 'index',
  actualEntries: Entry[],
  expectedEntries: Entry[],
): void {
  try {
    expect(actualEntries.map((entry) => entry.name)).toEqual(expectedEntries.map((entry) => entry.name))
  } catch (error) {
    throw new Error(`${capitalize(kind)} set mismatch\n${formatAssertionError(error)}`)
  }

  const actualEntriesByName = new Map(actualEntries.map((entry) => [entry.name, entry]))
  for (const expectedEntry of expectedEntries) {
    const actualEntry = actualEntriesByName.get(expectedEntry.name)
    if (!actualEntry) {
      throw new Error(`Missing ${kind} "${expectedEntry.name}" in migrated schema`)
    }

    try {
      expect(actualEntry).toEqual(expectedEntry)
    } catch (error) {
      throw new Error(`${capitalize(kind)} mismatch for "${expectedEntry.name}"\n${formatAssertionError(error)}`)
    }
  }
}

function formatAssertionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

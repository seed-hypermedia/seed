import {Database} from 'bun:sqlite'
import schemaSQL from './sqlite-schema.sql' with {type: 'text'}
import fs from 'node:fs'
import path from 'node:path'

export const LEGACY_SCHEMA_VERSION_KEY = 'schema_version'
export const SCHEMA_MIGRATION_VERSION_KEY = 'schema_migration_version'
export const BASELINE_SCHEMA_MIGRATION_VERSION = 0

// Add database migrations here in newest-first order (for user's convenience).
// The list is reversed immediately to be executed from the oldest migration for runtime correctness.
// Be very careful. Never delete and move existing migrations around.
// This list is prepend-only.
export const migrations = [].reverse()

export const desiredVersion = migrations.length
export const schema = stripSQLComments(schemaSQL).trim()

/** Result of opening the database. */
export type OpenResult = {ok: true; db: Database} | {ok: false; current: number; desired: number}

/**
 * Opens or creates the SQLite database, initializing the schema if needed.
 * Returns a discriminated union so the caller can handle version mismatches
 * without an exception.
 */
export function open(dbPath: string): OpenResult {
  fs.mkdirSync(path.dirname(dbPath), {recursive: true})
  const db = new Database(dbPath, {create: true, strict: true})
  const result = openWithDatabase(db)
  if (!result.ok) {
    db.close()
    return result
  }

  return result
}

/**
 * Shared open path for tests that need to operate on an already-open database.
 * Returns the same discriminated union as `open`, but never closes `db`.
 */
export function openWithDatabase(db: Database): OpenResult {
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')

  if (isEmptyDatabase(db)) {
    initializeEmptyDatabase(db)
    return {ok: true, db}
  }

  if (!hasServerConfigTable(db)) {
    return {ok: false, current: BASELINE_SCHEMA_MIGRATION_VERSION, desired: desiredVersion}
  }

  const legacyVersion = getServerConfigValue(db, LEGACY_SCHEMA_VERSION_KEY)
  if (legacyVersion !== null) {
    return {
      ok: false,
      current: parseSchemaMigrationVersion(legacyVersion) ?? BASELINE_SCHEMA_MIGRATION_VERSION,
      desired: desiredVersion,
    }
  }

  const currentVersionValue = getServerConfigValue(db, SCHEMA_MIGRATION_VERSION_KEY)
  if (currentVersionValue === null) {
    return {ok: false, current: BASELINE_SCHEMA_MIGRATION_VERSION, desired: desiredVersion}
  }

  const currentVersion = parseSchemaMigrationVersion(currentVersionValue)
  if (currentVersion === null || currentVersion > desiredVersion) {
    return {
      ok: false,
      current: currentVersion ?? BASELINE_SCHEMA_MIGRATION_VERSION,
      desired: desiredVersion,
    }
  }

  applyPendingMigrations(db, currentVersion)
  return {ok: true, db}
}

export function stripSQLComments(sql: string): string {
  let stripped = ''
  let i = 0
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' = 'normal'

  while (i < sql.length) {
    const char = sql[i]
    const nextChar = sql[i + 1]

    switch (state) {
      case 'normal':
        if (char === "'" || char === '"' || char === '`' || char === '[') {
          stripped += char
          state = char === "'" ? 'single' : char === '"' ? 'double' : char === '`' ? 'backtick' : 'bracket'
          i += 1
          continue
        }

        if (char === '-' && nextChar === '-') {
          state = 'line-comment'
          i += 2
          continue
        }

        if (char === '/' && nextChar === '*') {
          state = 'block-comment'
          i += 2
          continue
        }

        stripped += char
        i += 1
        continue

      case 'single':
        stripped += char
        i += 1
        if (char === "'" && sql[i] !== "'") {
          state = 'normal'
        } else if (char === "'" && sql[i] === "'") {
          stripped += sql[i]
          i += 1
        }
        continue

      case 'double':
        stripped += char
        i += 1
        if (char === '"' && sql[i] !== '"') {
          state = 'normal'
        } else if (char === '"' && sql[i] === '"') {
          stripped += sql[i]
          i += 1
        }
        continue

      case 'backtick':
        stripped += char
        i += 1
        if (char === '`') {
          state = 'normal'
        }
        continue

      case 'bracket':
        stripped += char
        i += 1
        if (char === ']') {
          state = 'normal'
        }
        continue

      case 'line-comment':
        if (char === '\n') {
          stripped += '\n'
          state = 'normal'
        }
        i += 1
        continue

      case 'block-comment':
        if (char === '*' && nextChar === '/') {
          state = 'normal'
          i += 2
          continue
        }
        if (char === '\n') {
          stripped += '\n'
        }
        i += 1
        continue
    }
  }

  return normalizeStrippedSQL(stripped)
}

export function getOrCreateHmacSecret(db: Database): Uint8Array {
  const row = db
    .query<{value: Uint8Array}, [string]>(`SELECT value FROM server_config WHERE key = ?`)
    .get('hmac_secret')

  if (row) {
    return new Uint8Array(row.value)
  }

  const secret = crypto.getRandomValues(new Uint8Array(32))
  db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, ['hmac_secret', secret])
  return secret
}

function isEmptyDatabase(db: Database): boolean {
  return db.query<{count: number}, []>('SELECT count(*) as count FROM sqlite_schema').get()?.count === 0
}

function initializeEmptyDatabase(db: Database): void {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(schema)
    setServerConfigValue(db, SCHEMA_MIGRATION_VERSION_KEY, String(desiredVersion))
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

function hasServerConfigTable(db: Database): boolean {
  return db.query(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'server_config' LIMIT 1`).get() !== null
}

function getServerConfigValue(db: Database, key: string): string | null {
  const row = db
    .query<{value: string | Uint8Array | ArrayBuffer}, [string]>(`SELECT value FROM server_config WHERE key = ?`)
    .get(key)
  if (!row) {
    return null
  }

  if (typeof row.value === 'string') {
    return row.value
  }

  const bytes = row.value instanceof Uint8Array ? row.value : new Uint8Array(row.value)
  return new TextDecoder().decode(bytes)
}

function setServerConfigValue(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO server_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
}

function parseSchemaMigrationVersion(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < BASELINE_SCHEMA_MIGRATION_VERSION) {
    return null
  }

  return parsed
}

function applyPendingMigrations(db: Database, currentVersion: number): void {
  const pendingMigrations = migrations.slice(currentVersion)
  if (pendingMigrations.length === 0) {
    return
  }

  db.run('BEGIN IMMEDIATE')
  try {
    for (const [offset, migration] of pendingMigrations.entries()) {
      const nextVersion = currentVersion + offset + 1
      const savepoint = `migration_${nextVersion}`

      db.run(`SAVEPOINT ${savepoint}`)
      try {
        db.run(migration)
        setServerConfigValue(db, SCHEMA_MIGRATION_VERSION_KEY, String(nextVersion))
        db.run(`RELEASE ${savepoint}`)
      } catch (error) {
        db.run(`ROLLBACK TO ${savepoint}`)
        db.run(`RELEASE ${savepoint}`)
        throw error
      }
    }

    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

function normalizeStrippedSQL(sql: string): string {
  const normalizedLines: string[] = []

  for (const rawLine of sql.split(/\r?\n/u)) {
    const line = rawLine.replace(/[ \t]+$/u, '')
    if (line.trim() === '') {
      continue
    }

    if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1]?.endsWith(';')) {
      normalizedLines.push('')
    }

    normalizedLines.push(line)
  }

  return normalizedLines.join('\n')
}

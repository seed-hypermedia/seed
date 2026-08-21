import {Database} from 'bun:sqlite'
import schemaSQL from './sqlite-schema.sql' with {type: 'text'}
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Legacy schema key used before migration-version tracking. */
export const LEGACY_SCHEMA_VERSION_KEY = 'schema_version'
/** Server config key storing the applied migration version. */
export const SCHEMA_MIGRATION_VERSION_KEY = 'schema_migration_version'
/** Version represented by the baseline schema file. */
export const BASELINE_SCHEMA_MIGRATION_VERSION = 0

/** Prepend-only database migrations. */
export const migrations: string[] = [
  // ======= IMPORTANT: Add new migrations below this line. =======
  // Optionally-public agents: when set, any signed account can read the agent by id (the same view
  // an invited reader gets). Owners toggle it from the collaborators panel via SetAgentPublicRead.
  `ALTER TABLE agents ADD COLUMN public_read INTEGER NOT NULL DEFAULT 0;`,
  // Agent-maintained status line: the `status` verb lets a session describe what it is doing so
  // session lists and parent sessions can see inside without opening the transcript.
  `ALTER TABLE sessions ADD COLUMN description TEXT;`,
  // Per-session model override (CBOR SessionModelOverride): a session can pin its own
  // provider/model/reasoning instead of always running the agent definition's model.
  `ALTER TABLE sessions ADD COLUMN model_override_cbor BLOB;`,
  // Agent-level invitations and accepted read/write collaborators. The invited account is a real
  // Seed principal and gets an accounts row before this membership row is inserted.
  `CREATE TABLE agent_collaborators (
      agent_id TEXT NOT NULL REFERENCES agents (id),
      account_id TEXT NOT NULL REFERENCES accounts (id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      accepted_at INTEGER,
      PRIMARY KEY (agent_id, account_id)
  ) WITHOUT ROWID;

  CREATE INDEX agent_collaborators_by_account ON agent_collaborators (account_id, status, updated_at DESC);`,
  // Run titles became mandatory: every enqueue site now derives a real one, so the display layer
  // never invents a label. Rows from before the requirement get the exact text the UI used to
  // fall back to, so their cards read the same as they always did.
  `UPDATE runs SET title = CASE
      WHEN kind = 'workflow' THEN 'Workflow'
      WHEN parent_run_id IS NOT NULL THEN 'Sub-session'
      ELSE 'Agent turn'
    END
    WHERE title IS NULL OR trim(title) = '';`,
  // What a trigger does when it fires. NULL means the only thing triggers used to do: start a new
  // thread. The event bus milestone moves this (and the rest of a trigger) into a Space document;
  // the column is where it lives until then.
  `ALTER TABLE agent_triggers ADD COLUMN continuation_cbor BLOB;`,
  // Waiting for something to happen, and continuing as a fresh run.
  //
  // Event waits get their own table rather than a marker on agent_triggers: a trigger is user
  // configuration (listed and edited in the desktop, carrying cooldowns and prompts), while a wait
  // is transient run state created by a running script and deleted the moment it is delivered,
  // times out, or its run dies. Sharing the table would mean filtering the marker out of every
  // trigger listing and mutation, forever, and a leaked row would read as a trigger the user never
  // made.
  `CREATE TABLE run_event_waits (
      run_id TEXT NOT NULL REFERENCES runs (id),
      wait_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      match_cbor BLOB NOT NULL,
      timeout_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, wait_id)
  ) WITHOUT ROWID;

  CREATE INDEX run_event_waits_by_account ON run_event_waits (account_id, created_at);

  ALTER TABLE runs ADD COLUMN continued_from_run_id TEXT;`,
  // The tool call that spawned a child run. It also rides in the run's input payload (the
  // executor's contract), but only a column can be read back without decoding every run: this is
  // what lets a delegate row in a transcript find the child it started while that child is
  // still working.
  `ALTER TABLE runs ADD COLUMN parent_tool_call_id TEXT;`,
  `CREATE TABLE tool_documents (
      account_id TEXT NOT NULL REFERENCES accounts (id),
      agent_id TEXT NOT NULL REFERENCES agents (id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      cid TEXT NOT NULL,
      doc_cbor BLOB NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, agent_id, name)
  ) WITHOUT ROWID;

  CREATE INDEX tool_documents_by_agent ON tool_documents (account_id, agent_id, updated_at DESC);`,
  `CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      root_run_id TEXT NOT NULL,
      parent_run_id TEXT REFERENCES runs (id),
      depth INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      agent_id TEXT REFERENCES agents (id),
      session_id TEXT REFERENCES sessions (id),
      trigger_firing_id TEXT REFERENCES trigger_firings (id),
      origin TEXT NOT NULL,
      title TEXT,
      model TEXT,
      source_cid TEXT,
      source_text TEXT,
      input_cbor BLOB NOT NULL,
      output_cbor BLOB,
      error_cbor BLOB,
      status TEXT NOT NULL,
      wait_cbor BLOB,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      not_before INTEGER,
      queue TEXT NOT NULL DEFAULT 'background',
      lease_owner TEXT,
      lease_expires_at INTEGER,
      budget_cbor BLOB,
      usage_cbor BLOB,
      plan_cbor BLOB,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE INDEX runs_dispatch ON runs (status, queue, not_before, created_at);
  CREATE INDEX runs_by_root ON runs (root_run_id, created_at);
  CREATE INDEX runs_by_parent ON runs (parent_run_id);
  CREATE INDEX runs_by_session ON runs (session_id, created_at DESC);
  CREATE INDEX runs_by_account ON runs (account_id, created_at DESC);

  CREATE TABLE run_journal (
      run_id TEXT NOT NULL REFERENCES runs (id),
      seq INTEGER NOT NULL,
      entry_cbor BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, seq)
  ) WITHOUT ROWID;

  ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions (id);
  ALTER TABLE sessions ADD COLUMN run_id TEXT;
  ALTER TABLE sessions ADD COLUMN plan_cbor BLOB;

  CREATE INDEX sessions_by_parent ON sessions (parent_session_id, created_at);`,
  `ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'system';
   UPDATE sessions
      SET title_source = CASE
        WHEN title IS NULL OR title = '' OR title = 'Untitled session' THEN 'system'
        ELSE 'user'
      END;`,
  `CREATE TABLE agent_drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      agent_id TEXT REFERENCES agents (id),
      signer_secret_name TEXT,
      title TEXT,
      content_format TEXT NOT NULL,
      content_cbor BLOB NOT NULL,
      metadata_cbor BLOB,
      edit_target TEXT,
      location_target TEXT,
      path_name TEXT,
      visibility TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER,
      published_id TEXT,
      published_version TEXT
  ) WITHOUT ROWID;

  CREATE INDEX agent_drafts_account_updated_idx ON agent_drafts (account_id, updated_at DESC);
  CREATE INDEX agent_drafts_agent_updated_idx ON agent_drafts (account_id, agent_id, updated_at DESC);
  CREATE INDEX agent_drafts_status_idx ON agent_drafts (account_id, status);`,
  `ALTER TABLE agent_triggers ADD COLUMN cooldown_ms INTEGER;`,
  `CREATE TABLE agent_triggers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      agent_id TEXT NOT NULL REFERENCES agents (id),
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      source_cbor BLOB NOT NULL,
      prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_checked_at INTEGER,
      last_fired_at INTEGER,
      last_error TEXT
  ) WITHOUT ROWID;

  CREATE INDEX agent_triggers_by_agent ON agent_triggers (agent_id, updated_at DESC);

  CREATE TABLE trigger_firings (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      agent_id TEXT NOT NULL REFERENCES agents (id),
      trigger_id TEXT NOT NULL REFERENCES agent_triggers (id),
      activity_key TEXT NOT NULL,
      session_id TEXT REFERENCES sessions (id),
      activity_cbor BLOB NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (account_id, trigger_id, activity_key)
  ) WITHOUT ROWID;

  CREATE INDEX trigger_firings_by_trigger ON trigger_firings (trigger_id, created_at DESC);

  CREATE TABLE activity_watermarks (
      account_id TEXT NOT NULL REFERENCES accounts (id),
      server_url TEXT NOT NULL,
      cursor_cbor BLOB NOT NULL,
      last_poll_at INTEGER,
      last_success_at INTEGER,
      last_error TEXT,
      PRIMARY KEY (account_id, server_url)
  ) WITHOUT ROWID;`,
  `CREATE TABLE action_idempotency (
      account_id TEXT NOT NULL,
      action TEXT NOT NULL,
      client_request_id TEXT NOT NULL,
      request_cbor BLOB NOT NULL,
      response_cbor BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, action, client_request_id)
  ) WITHOUT ROWID;`,
].reverse()

/** Desired SQLite migration version for this binary. */
export const desiredVersion = migrations.length
/** Normalized baseline schema SQL. */
export const schema = stripSQLComments(schemaSQL).trim()

/** Result of opening the database. */
export type OpenResult = {ok: true; db: Database} | {ok: false; current: number; desired: number}

/** Opens or creates the SQLite database, initializing schema if needed. */
export function open(dbPath: string): OpenResult {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), {recursive: true})
  }
  const db = new Database(dbPath, {create: true, strict: true})
  const result = openWithDatabase(db)
  if (!result.ok) {
    db.close()
    return result
  }
  return result
}

/** Initializes or validates an already-open database. */
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
    return {ok: false, current: currentVersion ?? BASELINE_SCHEMA_MIGRATION_VERSION, desired: desiredVersion}
  }

  applyPendingMigrations(db, currentVersion)
  return {ok: true, db}
}

/** Strips SQL comments while preserving string literals and statement spacing. */
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
        if (char === "'" && sql[i] !== "'") state = 'normal'
        else if (char === "'" && sql[i] === "'") {
          stripped += sql[i]
          i += 1
        }
        continue
      case 'double':
        stripped += char
        i += 1
        if (char === '"' && sql[i] !== '"') state = 'normal'
        else if (char === '"' && sql[i] === '"') {
          stripped += sql[i]
          i += 1
        }
        continue
      case 'backtick':
        stripped += char
        i += 1
        if (char === '`') state = 'normal'
        continue
      case 'bracket':
        stripped += char
        i += 1
        if (char === ']') state = 'normal'
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
        if (char === '\n') stripped += '\n'
        i += 1
        continue
    }
  }

  return normalizeStrippedSQL(stripped)
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
  if (!row) return null
  if (typeof row.value === 'string') return row.value
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
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < BASELINE_SCHEMA_MIGRATION_VERSION) return null
  return parsed
}

function applyPendingMigrations(db: Database, currentVersion: number): void {
  const pendingMigrations = migrations.slice(currentVersion)
  if (pendingMigrations.length === 0) return

  db.run('BEGIN IMMEDIATE')
  try {
    for (const [offset, migration] of pendingMigrations.entries()) {
      const nextVersion = currentVersion + offset + 1
      const savepoint = `migration_${nextVersion}`
      db.run(`SAVEPOINT ${savepoint}`)
      try {
        db.run(dedent(migration))
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
    if (line.trim() === '') continue
    if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1]?.endsWith(';'))
      normalizedLines.push('')
    normalizedLines.push(line)
  }
  return normalizedLines.join('\n')
}

function dedent(str: string): string {
  const lines = str
    .replace(/^\n/, '')
    .replace(/\n\s*$/, '')
    .split('\n')
  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0)
  const minIndent = indents.length ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(minIndent)).join('\n')
}

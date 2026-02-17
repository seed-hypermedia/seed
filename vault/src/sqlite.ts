import { Database } from "bun:sqlite"

/**
 * Bump this value whenever the schema changes.
 * When the stored version doesn't match, the server will refuse to start
 * and ask the operator to drop the database file manually.
 */
export const SCHEMA_VERSION = 2

/** Result of opening the database. */
export type OpenResult = { ok: true; db: Database } | { ok: false; current: number; desired: number }

/**
 * Opens or creates the SQLite database, initializing the schema if needed.
 * Returns a discriminated union so the caller can handle version mismatches
 * without an exception.
 */
export function open(filename: string): OpenResult {
	const db = new Database(filename, { create: true, strict: true })
	const isNew = db.query<{ count: number }, []>("SELECT count(*) as count FROM sqlite_schema").get()?.count === 0
	db.run("PRAGMA journal_mode = WAL")
	db.run("PRAGMA foreign_keys = ON")

	initSchema(db)

	const row = db
		.query<{ value: string }, [string]>("SELECT value FROM server_config WHERE key = ?")
		.get("schema_version")

	const current = row ? Number(row.value) : isNew ? SCHEMA_VERSION : 0
	if (current !== SCHEMA_VERSION) {
		db.close()
		return { ok: false, current, desired: SCHEMA_VERSION }
	}

	if (!row) {
		db.run("INSERT INTO server_config (key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)])
	}

	return { ok: true, db }
}

function initSchema(db: Database): void {
	db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        encrypted_data BLOB,
        version INTEGER NOT NULL DEFAULT 1,
        create_time INTEGER NOT NULL
    ) WITHOUT ROWID;

    -- Each credential wraps the user's DEK with its own KEK (Key Encryption Key).
    -- For passwords: KEK is derived from password via Argon2.
    -- For passkeys: KEK is derived from WebAuthn PRF extension output.
    CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        type TEXT NOT NULL, -- 'password' | 'passkey'
        encrypted_dek BLOB,
        -- Metadata (JSON) varies by credential type:
        -- password: { authHash: string }
        -- passkey: { credentialId, publicKey, counter, transports, backupEligible, backupState, prfEnabled }
        metadata JSON,
        create_time INTEGER NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS credentials_by_user_id ON credentials (user_id);

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        expire_time INTEGER NOT NULL,
        create_time INTEGER NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS sessions_by_user_id ON sessions (user_id);

    -- Temporary challenges for email verification flows (registration, email change).
    -- Challenges are short-lived and should be cleaned up after use or expiration.
    CREATE TABLE IF NOT EXISTS email_challenges (
        -- Unique identifier for this challenge instance (used for polling).
        id TEXT PRIMARY KEY,

        -- User this challenge belongs to (NULL for new user registration).
        user_id TEXT REFERENCES users (id),

        -- Purpose of the challenge: 'registration' | 'email_change'
        purpose TEXT NOT NULL,

        -- SHA-256 hash of the high-entropy token (token itself is sent in URL).
        token_hash TEXT NOT NULL,

        -- Email address associated with this challenge.
        -- For registration: the email being verified.
        -- For email_change: the current email.
        email TEXT NOT NULL,

        -- New email address (only for email_change purpose).
        new_email TEXT,

        -- Whether the email verification link has been clicked.
        verified INTEGER NOT NULL DEFAULT 0,

        -- Unix timestamp (ms) when this challenge expires.
        expire_time INTEGER NOT NULL
    ) WITHOUT ROWID;

    -- Index for cleanup queries by expiration time.
    CREATE INDEX IF NOT EXISTS email_challenges_by_expire_time ON email_challenges (expire_time);

    -- Key-value store for server configuration and secrets (e.g. HMAC keys).
    CREATE TABLE IF NOT EXISTS server_config (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
    ) WITHOUT ROWID;
  `)
}

export function getOrCreateHmacSecret(db: Database): Uint8Array {
	const row = db
		.query<{ value: Uint8Array }, [string]>(`SELECT value FROM server_config WHERE key = ?`)
		.get("hmac_secret")

	if (row) {
		return new Uint8Array(row.value)
	}

	const secret = crypto.getRandomValues(new Uint8Array(32))
	db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, ["hmac_secret", secret])
	return secret
}

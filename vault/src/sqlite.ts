import { Database } from "bun:sqlite"

/**
 * Opens or creates the SQLite database, initializing the schema if needed.
 */
export function open(filename: string): Database {
	const db = new Database(filename, { create: true, strict: true })
	db.run("PRAGMA journal_mode = WAL")
	db.run("PRAGMA foreign_keys = ON")
	db.transaction

	initSchema(db)
	return db
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

    -- Temporary authentication challenges for WebAuthn and email verification flows.
    -- Challenges are short-lived and should be cleaned up after use or expiration.
    CREATE TABLE IF NOT EXISTS auth_challenges (
        -- Unique identifier for this challenge instance (used for polling).
        id TEXT PRIMARY KEY,

        -- User this challenge belongs to (NULL for new user registration).
        user_id TEXT REFERENCES users (id),

        -- Challenge type: 'webauthn' for passkey flows, 'email' for magic link flows.
        type TEXT NOT NULL,

        -- Purpose of the challenge (NULL for webauthn, required for email).
        -- For email: 'registration' | 'email_change'
        purpose TEXT,

        -- The verifier value proving challenge completion.
        -- For webauthn: base64url-encoded challenge string signed by authenticator.
        -- For email: SHA-256 hash of the high-entropy token (token itself is sent in URL).
        verifier TEXT NOT NULL,

        -- Email address associated with this challenge.
        -- For registration: the email being verified.
        -- For email_change: the current email.
        email TEXT,

        -- New email address (only for email_change purpose).
        new_email TEXT,

        -- Whether the email verification link has been clicked.
        verified INTEGER NOT NULL DEFAULT 0,

        -- Unix timestamp (ms) when this challenge expires.
        expire_time INTEGER NOT NULL
    ) WITHOUT ROWID;

    -- Index for cleanup queries by expiration time.
    CREATE INDEX IF NOT EXISTS auth_challenges_by_expire_time ON auth_challenges (expire_time);
  `)
}

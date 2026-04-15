CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    encrypted_data BLOB,
    -- Incrementing integer for optimistic concurrency control.
    version INTEGER NOT NULL DEFAULT 1,
    create_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    type TEXT NOT NULL, -- 'password' | 'passkey' | 'secret'
    encrypted_dek BLOB,
    -- Metadata (JSON) varies by credential type:
    -- password: { authHash: string, salt: string }
    -- passkey: { credentialId, publicKey, counter, transports, backupEligible, backupState, prfEnabled }
    -- secret: { authHash: string }
    metadata JSON,
    create_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX credentials_by_user_id ON credentials (user_id);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    expire_time INTEGER NOT NULL,
    create_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX sessions_by_user_id ON sessions (user_id);

CREATE TABLE email_challenges (
    -- Unique identifier for this challenge instance (used for polling).
    id TEXT PRIMARY KEY,
    -- User this challenge belongs to (NULL for new user registration).
    user_id TEXT REFERENCES users (id),
    -- Purpose of the challenge: 'registration' | 'email_change'.
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

CREATE INDEX email_challenges_by_expire_time ON email_challenges (expire_time);

-- Stores various key-value pairs.
-- E.g. hmac_secret for session cookies, schema_migration_version for DB versioning.
CREATE TABLE server_config (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
) WITHOUT ROWID;

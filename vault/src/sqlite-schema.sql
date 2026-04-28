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

CREATE INDEX sessions_by_expire_time ON sessions (expire_time);

CREATE TABLE email_challenges (
    -- Registration email, or current account email when changing email.
    email TEXT PRIMARY KEY,
    -- SHA-256 hash of the browser binding cookie preimage.
    binding_hash TEXT NOT NULL,
    -- Contextual hash of the email verification code.
    code_hash TEXT NOT NULL,
    -- Target email address when changing email. NULL for registration.
    new_email TEXT,
    -- Number of failed code attempts.
    attempt_count INTEGER NOT NULL DEFAULT 0,
    -- Unix timestamp (ms) when this challenge was created.
    create_time INTEGER NOT NULL,
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

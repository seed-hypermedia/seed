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

-- Stores encrypted Vault Connect payloads,
-- which is used as a back-channel for browser and desktop app to exchange the vault credentials.
CREATE TABLE vault_connects (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    create_time INTEGER NOT NULL,
    expire_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX vault_connects_by_expire_time ON vault_connects (expire_time);

-- Invitation codes required to create an account when the server runs in invite-only mode.
CREATE TABLE invitations (
    code TEXT PRIMARY KEY,
    -- Optional email the code is bound to. When set, the account must register with this email.
    email TEXT,
    -- Unix timestamp (ms) when this invitation was created.
    create_time INTEGER NOT NULL,
    -- Unix timestamp (ms) when this invitation was redeemed. NULL while unused.
    used_time INTEGER,
    -- The user created with this invitation.
    used_by_account TEXT REFERENCES users (id),
    -- 'reader' (vault membership only) or 'writer' (a WRITER capability on the
    -- site's space is granted to the accounts the invited user registers).
    role TEXT NOT NULL DEFAULT 'reader'
) WITHOUT ROWID;

-- WRITER capabilities granted for writer invitations, one per account the
-- invited user reported, so the grant runs once per account.
CREATE TABLE invitation_grants (
    account_uid TEXT PRIMARY KEY,
    code TEXT NOT NULL REFERENCES invitations (code),
    -- The capability blob's id as the daemon reported it.
    capability_id TEXT,
    grant_time INTEGER NOT NULL
) WITHOUT ROWID;

-- Public account IDs each user keeps in their vault, reported by the client after
-- it decrypts the vault, so the admin API can answer membership checks.
-- The keys themselves stay inside the encrypted vault blob.
CREATE TABLE user_accounts (
    account_uid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    -- Account creation time as recorded in the vault (ms).
    create_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX user_accounts_by_user_id ON user_accounts (user_id);

-- Stores various key-value pairs.
-- E.g. hmac_secret for session cookies, schema_migration_version for DB versioning.
CREATE TABLE server_config (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
) WITHOUT ROWID;

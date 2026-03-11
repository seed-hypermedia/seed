CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    encrypted_data BLOB,
    version INTEGER NOT NULL DEFAULT 1,
    create_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    type TEXT NOT NULL,
    encrypted_dek BLOB,
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
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users (id),
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    new_email TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    expire_time INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX email_challenges_by_expire_time ON email_challenges (expire_time);

CREATE TABLE server_config (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
) WITHOUT ROWID;

CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE account_authorizations (
    account_id TEXT NOT NULL,
    signer TEXT NOT NULL,
    role TEXT NOT NULL,
    capability TEXT,
    created_at INTEGER NOT NULL,
    capability_cid TEXT,
    PRIMARY KEY (account_id, signer),
    FOREIGN KEY (account_id) REFERENCES accounts (id)
) WITHOUT ROWID;

CREATE TABLE model_providers (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_cbor BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (account_id, name)
) WITHOUT ROWID;

CREATE TABLE secrets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    name TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    metadata_cbor BLOB,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (account_id, name)
) WITHOUT ROWID;

CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    name TEXT NOT NULL,
    config_cbor BLOB NOT NULL,
    tools_cbor BLOB,
    status_cbor BLOB,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (account_id, name)
) WITHOUT ROWID;

CREATE INDEX mcp_servers_by_account ON mcp_servers (account_id, name);

CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    definition_cbor BLOB NOT NULL,
    state_dir TEXT NOT NULL,
    status TEXT NOT NULL,
    -- 1 when any signed account may read the agent (definition, memory, tools, sessions) by id.
    public_read INTEGER NOT NULL DEFAULT 0,
    public_chat INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX agents_by_account ON agents (account_id, updated_at DESC);

CREATE TABLE agent_collaborators (
    agent_id TEXT NOT NULL REFERENCES agents (id),
    account_id TEXT NOT NULL REFERENCES accounts (id),
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    accepted_at INTEGER,
    PRIMARY KEY (agent_id, account_id)
) WITHOUT ROWID;

CREATE INDEX agent_collaborators_by_account ON agent_collaborators (account_id, status, updated_at DESC);

CREATE TABLE agent_triggers (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    agent_id TEXT NOT NULL REFERENCES agents (id),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    source_cbor BLOB NOT NULL,
    prompt TEXT NOT NULL,
    continuation_cbor BLOB,
    cooldown_ms INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_checked_at INTEGER,
    last_fired_at INTEGER,
    last_error TEXT
) WITHOUT ROWID;

CREATE INDEX agent_triggers_by_agent ON agent_triggers (agent_id, updated_at DESC);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    agent_id TEXT NOT NULL REFERENCES agents (id),
    title TEXT,
    title_source TEXT NOT NULL DEFAULT 'system',
    status TEXT NOT NULL,
    parent_session_id TEXT REFERENCES sessions (id),
    run_id TEXT,
    plan_cbor BLOB,
    model_override_cbor BLOB,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX sessions_by_agent ON sessions (agent_id, updated_at DESC);

CREATE INDEX sessions_by_parent ON sessions (parent_session_id, created_at);

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
) WITHOUT ROWID;

CREATE TABLE session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id),
    seq INTEGER NOT NULL,
    event_cbor BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (session_id, seq)
) WITHOUT ROWID;

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    root_run_id TEXT NOT NULL,
    parent_run_id TEXT REFERENCES runs (id),
    parent_tool_call_id TEXT,
    continued_from_run_id TEXT,
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

CREATE TABLE run_event_waits (
    run_id TEXT NOT NULL REFERENCES runs (id),
    wait_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    match_cbor BLOB NOT NULL,
    timeout_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, wait_id)
) WITHOUT ROWID;

CREATE INDEX run_event_waits_by_account ON run_event_waits (account_id, created_at);

CREATE TABLE agent_drafts (
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
CREATE INDEX agent_drafts_status_idx ON agent_drafts (account_id, status);

CREATE TABLE action_idempotency (
    account_id TEXT NOT NULL,
    action TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    request_cbor BLOB NOT NULL,
    response_cbor BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, action, client_request_id)
) WITHOUT ROWID;

CREATE TABLE tool_documents (
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

CREATE INDEX tool_documents_by_agent ON tool_documents (account_id, agent_id, updated_at DESC);

CREATE TABLE server_config (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
) WITHOUT ROWID;

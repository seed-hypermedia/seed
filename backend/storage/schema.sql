-- Stores arbitrary key/value data that didn't deserve its own table.
CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT
) WITHOUT ROWID;

-- Stores the public keys that we know about.
-- The public key is stored in a principal encoding,
-- which is `<pub-key-type-multicodec><pub-key-bytes>`.
CREATE TABLE public_keys (
    id INTEGER PRIMARY KEY,
    principal BLOB UNIQUE NOT NULL
);

-- Stores the content of IPFS blobs.
CREATE TABLE blobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The multihash of the IPFS blob.
    -- We don't store CIDs, which is what most blockstore implementations do.
    -- We don't use multihash as a primary key to reduce the database size when using foreign keys.
    multihash BLOB UNIQUE NOT NULL,
    -- Multicodec describing the data stored in the blob.
    codec INTEGER NOT NULL,
    -- Byte size of the original uncompressed data.
    -- Size 0 indicates that data is stored inline in the multihash.
    -- Size -1 indicates that we somehow know about this hash, but don't have the data yet.
    size INTEGER DEFAULT (-1) NOT NULL,
    -- Subjective (locally perceived) time when this blob was inserted.
    insert_time INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
    -- Actual content of the block. Compressed with zstd.
    -- Stored at the end to make sure other columns don't go to the overflow pages in SQLite.
    data BLOB
);

-- Index for better data locality when we need to iterate over blobs without their data.
-- Without the index loading the entire list of blobs into memory takes forever,
-- because SQLite has to read way too many pages skipping the actual blob data.
CREATE INDEX blobs_metadata ON blobs (id, multihash, codec, size, insert_time);
CREATE INDEX blobs_metadata_by_hash ON blobs (multihash, codec, size, insert_time);

-- Stores some relevant attributes for structural blobs,
-- which are those blobs that we can understand more deeply than just an opaque blob.
CREATE TABLE structural_blobs (
    id INTEGER PRIMARY KEY REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    -- Type of the structural blob.
    type TEXT NOT NULL,
    -- For structural blobs that have timestamps,
    -- this is the timestamp in milliseconds.
    ts INTEGER,
    -- For structural blobs that have a clear author,
    -- this is the public key of the author.
    author INTEGER REFERENCES public_keys (id),
    -- For blobs that mutate a resource, this is a reference to the genesis blob.
    genesis_blob INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Some blobs are associated with a single resource.
    resource INTEGER REFERENCES resources (id),
    -- Additional attributes extracted from the blob's content.
    extra_attrs JSONB
) WITHOUT ROWID;

CREATE INDEX structural_blobs_by_resource ON structural_blobs (resource, type);
CREATE INDEX structural_blobs_by_genesis_blob ON structural_blobs (genesis_blob);
CREATE INDEX structural_blobs_by_author ON structural_blobs (author);
CREATE INDEX structural_blobs_by_type ON structural_blobs (type, ts, resource, author);

-- Index for tsid.
CREATE INDEX structural_blobs_by_tsid ON structural_blobs (extra_attrs->>'tsid') WHERE extra_attrs->>'tsid' IS NOT NULL;

-- Index for querying capabilities by delegate.
CREATE INDEX capabilities_by_delegate ON structural_blobs (extra_attrs->>'del', resource, author) WHERE type = 'Capability';

-- Index for querying profiles by alias.
CREATE INDEX profiles_by_alias ON structural_blobs (extra_attrs->>'alias', author) WHERE type = 'Profile' AND extra_attrs->>'alias' IS NOT NULL;

-- Index for querying profiles by subject.
CREATE INDEX contacts_by_subject ON structural_blobs (extra_attrs->>'subject', ts, author) WHERE type = 'Contact';

-- Stores blobs that we have failed to index for some reason.
-- Sometimes we still keep the blob, even if we have failed to index it,
-- because we might be able to index it later, e.g. when some other related blobs arrive out of order.
CREATE TABLE stashed_blobs (
    -- ID of the blob that we failed to index.
    id INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    -- Reason why we failed to index the blob.
    reason TEXT NOT NULL,
    -- Some extra information that might be useful depending on the reason.
    -- Application-level concern.
    extra_attrs JSON NOT NULL,
    PRIMARY KEY (id, reason, extra_attrs)
) WITHOUT ROWID;

-- Stores hypermedia resources.
-- All resources are identified by an IRI[iri],
-- might have an owner identified by a public key.
--
-- [iri]: https://en.wikipedia.org/wiki/Internationalized_Resource_Identifier
CREATE TABLE resources (
    id INTEGER PRIMARY KEY,
    iri TEXT UNIQUE NOT NULL,
    owner INTEGER REFERENCES public_keys (id),
    genesis_blob INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- For resource that we can infer a creation time.
    -- Stored as unix timestamp in *seconds*.
    create_time INTEGER
);

CREATE INDEX resources_by_owner ON resources (owner) WHERE owner IS NOT NULL;
CREATE INDEX resources_by_genesis_blob ON resources (genesis_blob);

-- Stores resources that are unread by the user.
CREATE TABLE unread_resources (
    iri TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

-- Stores spaces and various aggregate information about them.
CREATE TABLE spaces (
    id TEXT PRIMARY KEY CHECK (id != ''),
    last_comment INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
    last_comment_time INTEGER NOT NULL DEFAULT (0),
    comment_count INTEGER NOT NULL DEFAULT (0),
    last_change_time INTEGER NOT NULL DEFAULT (0)
) WITHOUT ROWID;

-- Index to fullfill the rule of having an index on all foreign keys.
CREATE INDEX spaces_by_last_comment ON spaces (last_comment) WHERE last_comment IS NOT NULL;

-- Stores document generations, with lots of consolidated information.
CREATE TABLE document_generations (
    resource INTEGER REFERENCES resources (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    generation INTEGER NOT NULL,
    genesis TEXT NOT NULL,
    heads JSON NOT NULL DEFAULT ('[]'),
    change_count INTEGER NOT NULL DEFAULT (0),
    genesis_change_time INTEGER NOT NULL,
    last_change_time INTEGER NOT NULL DEFAULT (0),
    last_tombstone_ref_time INTEGER NOT NULL DEFAULT (0),
    last_alive_ref_time INTEGER NOT NULL DEFAULT (0),
    is_deleted GENERATED ALWAYS AS (last_tombstone_ref_time > last_alive_ref_time) VIRTUAL,
    last_comment INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
    last_comment_time INTEGER NOT NULL DEFAULT (0),
    last_activity_time GENERATED ALWAYS AS (MAX(last_comment_time, last_alive_ref_time)) VIRTUAL,
    comment_count INTEGER NOT NULL DEFAULT (0),
    -- Sorted JSON array of unique author ID values.
    authors JSON NOT NULL DEFAULT ('[]'),
    -- Indexed document attributes,
    -- values are timestamped with the timestamped of the change that introduced them.
    metadata JSON NOT NULL DEFAULT ('{}'),
    -- Roaring bitmap of change blob IDs.
    changes BLOB,
    PRIMARY KEY (resource, generation, genesis)
) WITHOUT ROWID;

-- Index to fullfill the rule of having an index on all foreign keys.
CREATE INDEX document_generations_by_last_comment ON document_generations (last_comment) WHERE last_comment IS NOT NULL;

-- Stores content-addressable links between blobs.
-- Links are typed (rel) and directed.
CREATE TABLE blob_links (
    source INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    target INTEGER REFERENCES blobs (id) ON UPDATE CASCADE NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (source, type, target)
) WITHOUT ROWID;

CREATE UNIQUE INDEX blob_backlinks ON blob_links (target, type, source);

-- Stores links from blobs to resources.
-- Resource links can be open-ended or pinned.
-- Pinned links point to a specific version of the resource.
-- Version is determined by the has of one or multiple blobs.
-- Non-pinned links point to the latest version of the resource we can find.
-- Extra metadata can be stored along with the link, probably in JSON format.
CREATE TABLE resource_links (
    id INTEGER PRIMARY KEY,
    source INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    target INTEGER REFERENCES resources (id) NOT NULL,
    type TEXT NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT (0),
    -- Additional attributes to be kept with the link.
    extra_attrs JSONB
);

CREATE INDEX resource_links_by_source ON resource_links (source, is_pinned, target);
CREATE INDEX resource_links_by_target ON resource_links (target, source);

-- Stores subscribed resources. Once we subscribe to a resource,
-- we will sync the latest versions of it periodically.
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY,
    -- The resource we are subscribing to.
    iri TEXT UNIQUE NOT NULL,
    -- Whether we subscribe recursively to all documents in the directory or not
    is_recursive BOOLEAN DEFAULT false NOT NULL,
    -- The time when the resource was subscribed.
    insert_time INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

-- Stores seed peers we know about.
CREATE TABLE peers (
    -- Internal index used for pagination
    id INTEGER PRIMARY KEY,
    -- Network unique peer identifier.
    pid TEXT UNIQUE NOT NULL,
    -- List of addresses in multiaddress format (comma separated)
    addresses TEXT UNIQUE NOT NULL,
    -- If we got the peer via direct connection or some other peer shared it with us.
    explicitly_connected BOOLEAN DEFAULT false NOT NULL,
    -- The time when the peer was first stored.
    created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
    -- When the peer updated its addresses for the last time.
    updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

-- Stores Lightning wallets both externals (imported wallets like bluewallet
-- based on lndhub) and internals (based on the LND embedded node).
CREATE TABLE wallets (
    -- Wallet unique ID. Is the connection uri hashed with the account.
    id TEXT PRIMARY KEY,
    -- Account
    account INTEGER REFERENCES public_keys (id) ON DELETE CASCADE NOT NULL,
    -- The type of the wallet.
    type TEXT CHECK( type IN ('lnd','lndhub.go','lndhub') ) NOT NULL DEFAULT 'lndhub.go',
    -- Address of the LND node backing up this wallet. In case lndhub, this will be the
    -- URL to connect via rest api. In case LND wallet, this will be the gRPC address.
    address TEXT NOT NULL,
    -- The login to access the wallet. Login in case lndhub and the macaroon
    -- bytes in case lnd.
    login BLOB NOT NULL,
    -- The password to access the wallet. Passphrase in case of lndhub and the encryption
    -- key to unlock the internal wallet in case of LND.
    password BLOB NOT NULL,
    -- The Authentication token of the wallet. api token in case of lndhub
    token BLOB,
    -- Human readable name to help the user identify each wallet
    name TEXT NOT NULL
);

CREATE INDEX wallets_by_account ON wallets (account);

-- Stores text content to to a full text search
-- https://sqlite.org/fts5.html.

CREATE VIRTUAL TABLE fts USING fts5(
    -- The text content to be indexed.
    raw_content,
    -- The type of the content being indexed. It could be
    -- a title, a document body, or a comment.
    type UNINDEXED,
    -- The id of the blob of the blob containting the change.
    -- With the raw_contnet in it.
    blob_id UNINDEXED,
    -- The ID of the block that contains the content.
    -- Only relevant on type=document,comment.
    block_id UNINDEXED,
    -- The version of the document that contains
    -- the change. Only relevant on type=document,comment
    version UNINDEXED
);

-- Since we cannot create indexes on virtual tables,
-- we create a separate table to store the FTS index.
-- This is needed to speed up the search of what FTSentries
-- we have to update when a blob is updated.
CREATE TABLE fts_index (
    -- The rowid of the FTS entry.
    rowid INTEGER PRIMARY KEY,
    -- The blob ID of the blob that contains the content.
    blob_id INTEGER NOT NULL,
    -- The version of the document that contains the content.
    version TEXT NOT NULL,
    -- The block ID of the block that contains the content.
    block_id TEXT NOT NULL,
    -- The type of the content being indexed.
    type TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX fts_index_by_blob ON fts_index (blob_id);
CREATE INDEX fts_index_by_version ON fts_index (version);
CREATE INDEX fts_index_by_block ON fts_index (block_id);
CREATE INDEX fts_index_by_type ON fts_index (type);
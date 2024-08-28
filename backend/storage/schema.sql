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
    -- Actual content of the block. Compressed with zstd.
    data BLOB,
    -- Byte size of the original uncompressed data.
    -- Size 0 indicates that data is stored inline in the multihash.
    -- Size -1 indicates that we somehow know about this hash, but don't have the data yet.
    size INTEGER DEFAULT (-1) NOT NULL,
    -- Subjective (locally perceived) time when this blob was inserted.
    insert_time INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
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
    -- this is the UNIX timestamp in microseconds.
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

-- TODO(hm24): Create necessary indexes for structural blobs.

-- TODO(hm24): Create necessary table for the feed API.


-- View blobs metadata It returns the latest non null title or the 
-- latest blob in case of untitled meta.
CREATE VIEW meta_view AS
WITH RankedBlobs AS (
    SELECT 
        change_sb.id, 
        change_sb.extra_attrs AS meta, 
        change_sb.author, 
        ref_sb.resource, 
        change_sb.ts, 
        ROW_NUMBER() OVER (
            PARTITION BY ref_sb.resource 
            ORDER BY 
                ref_sb.ts DESC
        ) AS rank
    FROM 
        structural_blobs change_sb
    JOIN 
        structural_blobs ref_sb
    ON 
        change_sb.ts = ref_sb.ts
    WHERE 
        change_sb.type = 'Change' 
        AND ref_sb.type = 'Ref'
        AND change_sb.extra_attrs IS NOT NULL
),
LatestBlobs AS (
    SELECT 
        rb.id,
        rb.meta, 
        rb.author, 
        rb.resource, 
        rb.ts
    FROM RankedBlobs rb
    WHERE rb.rank = 1
)
SELECT 
    lb.meta AS extra_attrs, 
    res.iri, 
    pk.principal
FROM LatestBlobs lb
JOIN resources res ON res.id = lb.resource
JOIN public_keys pk ON pk.id = lb.author
WHERE extra_attrs IS NOT NULL;
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

-- Stores the heads for a given resource.
-- Heads are the latest changes to a given resource.
-- Heads are derived from Ref blobs or from Change blobs that update the index of a parent document.
CREATE TABLE resource_heads (
    -- Resource ID for which the head is for.
    resource INTEGER REFERENCES resources (id) ON DELETE CASCADE ON UPDATE CASCADE NOT NULL,
    -- Blob that introduces the head.
    source_blob INTEGER REFERENCES blobs (id) ON DELETE CASCADE ON UPDATE CASCADE NOT NULL,
    -- The JSON array of head blob IDs.
    heads JSONB NOT NULL,
    author INTEGER REFERENCES public_keys (id) NOT NULL,
    ts INTEGER NOT NULL
);

CREATE INDEX resources_by_owner ON resources (owner) WHERE owner IS NOT NULL;

-- Stores deleted hypermedia resources.
-- In order to bring back content we need to keep track of 
-- what's been deleted. Also, in order not to sync it back
-- accidentally, we need to check whether the blob is related
-- to a deleted resource.
CREATE TABLE deleted_resources (
    iri TEXT PRIMARY KEY,
    delete_time INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
    reason TEXT,
    -- Additional attributes extracted from the blob's content,
    -- that might be relevant to keep in order to undelete the resource at some point.
    extra_attrs JSONB
);

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
    iri INTEGER REFERENCES resources (id) ON DELETE CASCADE NOT NULL,
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
    addresses TEXT UNIQUE NOT NULL
);

-- Stores Lightning wallets both externals (imported wallets like bluewallet
-- based on lndhub) and internals (based on the LND embedded node).
CREATE TABLE wallets (
    -- Wallet unique ID. Is the connection uri hash.
    id TEXT PRIMARY KEY,
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
    name TEXT NOT NULL,
    -- The balance in satoshis
    balance INTEGER DEFAULT 0
);

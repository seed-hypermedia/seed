package mttnet

import (
	"context"
	"fmt"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/syncing/rbsr"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
)

// ReconcileBlobs reconciles a set of blobs from the initiator. Finds the difference from what we have.
func (srv *rpcMux) ReconcileBlobs(ctx context.Context, in *p2p.ReconcileBlobsRequest) (*p2p.ReconcileBlobsResponse, error) {
	store := rbsr.NewSliceStore()
	ne, err := rbsr.NewSession(store, 50000)
	if err != nil {
		return nil, err
	}

	conn, release, err := srv.Node.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("Could not get connection: %w", err)
	}
	defer release()
	var query string = qListAllBlobsStr
	var queryParams []interface{}
	if len(in.Filters) != 0 {
		query = QListrelatedBlobsStr
		for i, filter := range in.Filters {
			query += "?"
			if filter.Recursive {
				queryParams = append(queryParams, filter.Resource+"*")
			} else {
				queryParams = append(queryParams, filter.Resource)
			}
			if i < len(in.Filters)-1 {
				query += " OR iri GLOB "
			}
		}
		query += QListRelatedBlobsContStr
	}
	if err = sqlitex.Exec(conn, query, func(stmt *sqlite.Stmt) error {
		codec := stmt.ColumnInt64(0)
		hash := stmt.ColumnBytesUnsafe(1)
		ts := stmt.ColumnInt64(2)
		c := cid.NewCidV1(uint64(codec), hash)
		return store.Insert(ts, c.Bytes())
	}, queryParams...); err != nil {
		return nil, fmt.Errorf("Could not list related blobs: %w", err)
	}

	var queryParams2 []interface{}
	if len(in.Filters) != 0 {
		query = QListEmbeddedBlobsStr
		for i, filter := range in.Filters {
			query += "?"
			if filter.Recursive {
				queryParams2 = append(queryParams2, filter.Resource+"*")
			} else {
				queryParams2 = append(queryParams2, filter.Resource)
			}
			if i < len(in.Filters)-1 {
				query += " OR res.iri GLOB "
			}
		}
		query += QListEmbeddedBlobsContStr
	}
	if err = sqlitex.Exec(conn, query, func(stmt *sqlite.Stmt) error {
		codec := stmt.ColumnInt64(0)
		hash := stmt.ColumnBytesUnsafe(1)
		ts := stmt.ColumnInt64(2)
		c := cid.NewCidV1(uint64(codec), hash)
		return store.Insert(ts, c.Bytes())
	}, queryParams...); err != nil {
		return nil, fmt.Errorf("Could not list related embeds: %w", err)
	}

	if err = store.Seal(); err != nil {
		return nil, err
	}
	out, err := ne.Reconcile(in.Ranges)
	if err != nil {
		return nil, err
	}
	return &p2p.ReconcileBlobsResponse{
		Ranges: out,
	}, nil
}

const qListAllBlobsStr = (`
SELECT
	blobs.codec,
	blobs.multihash,
	blobs.insert_time,
	?
FROM blobs INDEXED BY blobs_metadata LEFT JOIN structural_blobs sb ON sb.id = blobs.id
WHERE blobs.size >= 0
ORDER BY sb.ts, blobs.multihash;
`)

// QListEmbeddedBlobsStr gets embedded blobs related to multiple eids
const QListEmbeddedBlobsStr = `
SELECT distinct
blobs.codec,
blobs.multihash,
blobs.insert_time
FROM blobs INDEXED BY blobs_metadata 
LEFT JOIN structural_blobs sb ON sb.id = blobs.id
LEFT JOIN structural_blobs sb2 ON sb.ts = sb2.ts
LEFT JOIN resources res ON sb2.resource = res.id
WHERE blobs.size >= 0 AND res.id IN (
SELECT distinct rl.target 
FROM structural_blobs sb
LEFT JOIN structural_blobs sb2 ON sb.ts = sb2.ts
JOIN resource_links rl ON sb2.id = rl.source
WHERE sb.resource IS NOT NULL AND sb.id IN (
WITH RECURSIVE
refs (id) AS (
SELECT id
FROM structural_blobs
WHERE type = 'Ref'
-- resource
AND resource IN (SELECT id FROM resources WHERE iri GLOB `

const QListEmbeddedBlobsContStr = `)
),
changes (id) AS (
SELECT bl.target
FROM blob_links bl
JOIN refs r ON r.id = bl.source AND bl.type = 'ref/head'
UNION
SELECT bl.target
FROM blob_links bl
JOIN changes c ON c.id = bl.source
WHERE bl.type = 'change/dep'
)
SELECT
b.id
FROM blobs b
JOIN refs r ON r.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
b.id
FROM blobs b
JOIN changes ch ON ch.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
))
ORDER BY sb.ts, blobs.multihash;`

// QListrelatedBlobsString gets blobs related to multiple eids
const QListrelatedBlobsStr = `
WITH RECURSIVE
refs (id) AS (
	SELECT id
	FROM structural_blobs
	WHERE type = 'Ref'
	AND resource IN (SELECT id FROM resources WHERE iri GLOB `

// QListRelatedBlobsContStr gets blobs related to multiple eids
const QListRelatedBlobsContStr = `)
),
comments (id) AS (
	SELECT bl.source
	FROM blob_links bl
	WHERE bl.type = 'comment/target'
),
changes (id) AS (
	SELECT bl.target
	FROM blob_links bl
	JOIN refs r ON r.id = bl.source AND bl.type = 'ref/head'
	UNION
	SELECT bl.target
	FROM blob_links bl
	JOIN changes c ON c.id = bl.source
	WHERE bl.type = 'change/dep'
)
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN refs r ON r.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN changes ch ON ch.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN comments ch ON ch.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
ORDER BY sb.ts, b.multihash;`

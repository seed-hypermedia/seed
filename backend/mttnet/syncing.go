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
		query += QListrelatedCapabilitiesStr
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
		query += QListrelatedCommentsStr
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
		query += QListrelatedEmbedsStr
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

// QListrelatedBlobsString gets blobs related to multiple eids
const QListrelatedBlobsStr = `
WITH RECURSIVE
refs (id) AS (
	SELECT id
	FROM structural_blobs
	WHERE type = 'Ref'
	AND resource IN (SELECT id FROM resources WHERE iri GLOB `

// QListrelatedCapabilitiesStr gets blobs related to multiple eids
const QListrelatedCapabilitiesStr = `)
),
capabilities (id) AS (
	SELECT id
	FROM structural_blobs
	WHERE type = 'Capability'
	AND resource IN (SELECT id FROM resources WHERE iri GLOB `

// QListrelatedCommentsStr gets blobs related to multiple eids
const QListrelatedCommentsStr = `)
),
comments (id) AS (
	SELECT rl.source
	FROM resource_links rl
	WHERE rl.type GLOB 'comment/*'
	AND rl.target IN (SELECT id FROM resources WHERE iri GLOB  `

// QListrelatedEmbedsStr gets blobs related to multiple eids
const QListrelatedEmbedsStr = `)
),
embeds (id) AS (
	SELECT rl.source
	FROM resource_links rl
	WHERE rl.type GLOB 'doc/*'
	AND rl.target IN (SELECT id FROM resources WHERE iri GLOB  `

// QListRelatedBlobsContStr gets blobs related to multiple eids
const QListRelatedBlobsContStr = `)
),
metadata (id) AS (
	SELECT bl.source
	FROM blob_links bl
	WHERE bl.type GLOB 'metadata/*'
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
JOIN comments co ON co.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN metadata meta ON meta.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN embeds eli ON eli.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
UNION ALL
SELECT
codec,
b.multihash,
insert_time,
b.id,
sb.ts
FROM blobs b
JOIN capabilities cap ON cap.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
ORDER BY sb.ts, b.multihash;`

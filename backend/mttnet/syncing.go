package mttnet

import (
	"context"
	"fmt"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/syncing/rbsr"
	"seed/backend/util/dqb"

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

	var qListAllBlobs = dqb.Str(`
	SELECT
		blobs.codec,
		blobs.multihash,
		blobs.insert_time,
		?
	FROM blobs INDEXED BY blobs_metadata LEFT JOIN structural_blobs sb ON sb.id = blobs.id
	WHERE blobs.size >= 0 
	ORDER BY sb.ts, blobs.multihash;
`)

	var qListrelatedBlobs = dqb.Str(`
	SELECT
		blobs.codec,
		blobs.multihash,
		blobs.insert_time
	FROM blobs INDEXED BY blobs_metadata 
	LEFT JOIN structural_blobs sb ON sb.id = blobs.id
	LEFT JOIN structural_blobs sb2 ON sb.ts = sb2.ts
	LEFT JOIN resources res ON sb2.resource = res.id
	WHERE blobs.size >= 0 AND (res.iri LIKE ?)
	ORDER BY sb.ts, blobs.multihash;
`)
	conn, release, err := srv.Node.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("Could not get connection: %w", err)
	}
	defer release()
	query := qListAllBlobs
	var iriList any = nil
	var iriString string
	if len(in.Filters) != 0 {
		query = qListrelatedBlobs
		for i, filter := range in.Filters {
			iriString += filter.Resource
			if filter.Recursive {
				iriString += "%"
			}
			if i < len(in.Filters)-1 {
				iriString += " OR res.iri LIKE "
			}
		}
		iriList = iriString
	}

	if err = sqlitex.Exec(conn, query(), func(stmt *sqlite.Stmt) error {
		codec := stmt.ColumnInt64(0)
		hash := stmt.ColumnBytesUnsafe(1)
		ts := stmt.ColumnInt64(2)
		c := cid.NewCidV1(uint64(codec), hash)
		store.Insert(ts, c.Bytes())
		return nil
	}, iriList); err != nil {
		return nil, fmt.Errorf("Could not list: %w", err)
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

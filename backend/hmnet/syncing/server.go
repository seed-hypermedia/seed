package syncing

import (
	"context"
	"seed/backend/blob"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"

	"github.com/ipfs/boxo/blockstore"
	"google.golang.org/grpc"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Server is the RPC handler for the syncing service.
type Server struct {
	db    *sqlitex.Pool
	blobs blockstore.Blockstore
}

// NewServer creates a new RPC handler instance.
// It has to be further registered with the actual [grpc.Server].
func NewServer(db *sqlitex.Pool, bs blockstore.Blockstore) *Server {
	return &Server{
		db:    db,
		blobs: bs,
	}
}

// RegisterServer registers the instance with the gRPC server.
func (s *Server) RegisterServer(srv grpc.ServiceRegistrar) {
	p2p.RegisterSyncingServer(srv, s)
}

// ReconcileBlobs reconciles a set of blobs from the initiator. Finds the difference from what we have.
func (s *Server) ReconcileBlobs(ctx context.Context, in *p2p.ReconcileBlobsRequest) (*p2p.ReconcileBlobsResponse, error) {
	store, err := s.loadStore(ctx, in.Filters)
	if err != nil {
		return nil, err
	}

	ne, err := rbsr.NewSession(store, 50000)
	if err != nil {
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

func (s *Server) loadStore(ctx context.Context, filters []*p2p.Filter) (rbsr.Store, error) {
	store := rbsr.NewSliceStore()

	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		for _, f := range filters {
			dkey := discoveryKey{
				IRI:       blob.IRI(f.Resource),
				Recursive: f.Recursive,
			}

			if err := loadRBSRStore(conn, dkey, store); err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		return nil, err
	}

	return store, store.Seal()
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
const qListRelatedBlobsStr = `
WITH RECURSIVE
refs (id) AS (
	SELECT id
	FROM structural_blobs
	WHERE type = 'Ref'
	AND resource IN (SELECT id FROM resources WHERE iri GLOB `

// qListRelatedCapabilitiesStr gets blobs related to multiple eids
const qListRelatedCapabilitiesStr = `)
),
capabilities (id) AS (
	SELECT id
	FROM structural_blobs
	WHERE type = 'Capability'
	AND resource IN (SELECT id FROM resources WHERE iri GLOB `

// qListRelatedCommentsStr gets blobs related to multiple eids
const qListRelatedCommentsStr = `)
),
comments (id) AS (
	SELECT rl.source
	FROM resource_links rl
	WHERE rl.type GLOB 'comment/*'
	AND rl.target IN (SELECT id FROM resources WHERE iri GLOB  `

// qListRelatedEmbedsStr gets blobs related to multiple eids
const qListRelatedEmbedsStr = `)
),
embeds (id) AS (
	SELECT rl.source
	FROM resource_links rl
	WHERE rl.type GLOB 'doc/*'
	AND rl.target IN (SELECT id FROM resources WHERE iri GLOB  `

// qListRelatedBlobsContStr gets blobs related to multiple eids
const qListRelatedBlobsContStr = `)
),
changes (id) AS (
	SELECT bl.target
	FROM blob_links bl
	JOIN refs r ON r.id = bl.source AND (bl.type = 'ref/head' OR bl.type GLOB 'metadata/*')
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
JOIN capabilities cap ON cap.id = b.id
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
JOIN embeds eli ON eli.id = b.id
JOIN structural_blobs sb ON sb.id = b.id
ORDER BY sb.ts, b.multihash;`

package syncing

import (
	"context"
	"fmt"
	"seed/backend/blob"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hmnet/netutil"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/strbytes"
	"strings"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

// DefaultDiscoveryTimeout is how long do we wait to discover a peer and sync with it
const (
	DefaultDiscoveryTimeout = time.Second * 30
	DefaultSyncingTimeout   = 1 * DefaultDiscoveryTimeout / 3
	DefaultDHTTimeout       = 2 * DefaultDiscoveryTimeout / 3
)

// DiscoverObject discovers an object in the network. If not found, then it returns an error
// If found, this function will store the object locally so that it can be gotten like any
// other local object. This function blocks until either success or fails to find providers.
func (s *Service) DiscoverObject(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool) (string, error) {
	if s.cfg.NoDiscovery {
		return "", fmt.Errorf("remote content discovery is disabled")
	}

	if s.docGetter == nil {
		return "", fmt.Errorf("Document getter not set")
	}
	ctxLocalPeers, cancel := context.WithTimeout(ctx, DefaultSyncingTimeout)
	defer cancel()
	c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(entityID))
	if err != nil {
		return "", fmt.Errorf("Couldn't encode eid into CID: %w", err)
	}

	acc, path, err := entityID.SpacePath()
	if err != nil {
		return "", err
	}

	accstr := acc.String()
	vstr := version.String()

	if version != "" {
		doc, err := s.docGetter.GetDocument(ctxLocalPeers, &documents.GetDocumentRequest{
			Account: accstr,
			Path:    path,
			Version: vstr,
		})
		if err == nil && doc.Version == vstr {
			s.log.Debug("It's your lucky day, the document was already in the db!. we avoided syncing with peers.")
			return doc.Version, nil
		}
	}

	conn, release, err := s.db.Conn(ctxLocalPeers)
	if err != nil {
		s.log.Debug("Could not grab a connection", zap.Error(err))
		return "", err
	}

	subsMap := make(subscriptionMap)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	if err = sqlitex.Exec(conn, qListPeersWithPid(), func(stmt *sqlite.Stmt) error {
		addresStr := stmt.ColumnText(0)
		pid := stmt.ColumnText(1)
		addrList := strings.Split(addresStr, ",")
		info, err := netutil.AddrInfoFromStrings(addrList...)
		if err != nil {
			s.log.Warn("Can't discover from peer since it has malformed addresses", zap.String("PID", pid), zap.Error(err))
			return nil
		}
		if s.host.Network().Connectedness(info.ID) == network.Connected {
			allPeers = append(allPeers, info.ID)
		}

		return nil
	}); err != nil {
		release()
		return "", err
	}
	release()
	if len(allPeers) != 0 {
		s.log.Debug("Discovering via connected local peers first", zap.Error(err))
		eidsMap := make(map[string]bool)
		eidsMap[string(entityID)] = recursive
		for _, pid := range allPeers {
			// TODO(juligasa): look into the providers store who has each eid
			// instead of pasting all peers in all documents.
			subsMap[pid] = eidsMap
		}

		res := s.syncWithManyPeers(ctxLocalPeers, subsMap)
		if res.NumSyncOK > 0 {
			doc, err := s.docGetter.GetDocument(ctxLocalPeers, &documents.GetDocumentRequest{
				Account: accstr,
				Path:    path,
			})
			if err == nil && (version == "" || doc.Version == vstr) {
				s.log.Debug("Discovered content via local peer, we avoided hitting the DHT!")
				return doc.Version, nil
			}
		}
	}
	s.log.Debug("None of the local peers have the document, hitting the DHT :(")
	// Arbitrary number of maximum providers
	maxProviders := 15

	// If we are looking for a specific version, we don't need to limit the number of providers,
	// because we will short-circuit as soon as we found the desired version.
	if version != "" {
		maxProviders = 0
	}
	ctxDHT, cancelDHTCtx := context.WithTimeout(ctx, DefaultDHTTimeout)
	defer cancelDHTCtx()
	peers := s.bitswap.FindProvidersAsync(ctxDHT, c, maxProviders)
	if len(peers) == 0 {
		return "", fmt.Errorf("After checking local peers, no dht providers were found serving CID %s", c.String())
	}

	eidsMap := make(map[string]bool)
	eidsMap[string(entityID)] = recursive
	subsMap = make(subscriptionMap)
	for p := range peers {
		p := p
		// TODO(juligasa): look into the providers store who has each eid
		// instead of pasting all peers in all documents.
		subsMap[p.ID] = eidsMap
	}

	res := s.syncWithManyPeers(ctxDHT, subsMap)
	if res.NumSyncOK > 0 {
		doc, err := s.docGetter.GetDocument(ctxDHT, &documents.GetDocumentRequest{
			Account: accstr,
			Path:    path,
			Version: vstr,
		})
		if err == nil && (version == "" || doc.Version == vstr) {
			s.log.Debug("Discovered content via DHT")
			return doc.Version, nil
		}
	}
	return "", fmt.Errorf("Found some DHT providers but could not get document from them %s", c.String())
}

func (s *Service) discoverObject(ctx context.Context, iri blob.IRI, version blob.Version, recursive bool) (blob.Version, error) {
	dkey := discoveryKey{
		IRI:       iri,
		Version:   version,
		Recursive: recursive,
	}

	c := s.single.DoChanContext(ctx, dkey, func(ctx context.Context) (blob.Version, error) {
		// Giving some time before letting another discovery for this key to happen.
		// The frontend is currently calling this function very agressively.
		defer time.AfterFunc(time.Second*30, func() {
			s.single.Forget(dkey)
		})

		// Check if the entity exists in the local store.

		// Fill up the RBSR store and spawn a goroutine to sync with the peers.
		// store := rbsr.NewSliceStore()
		panic("TODO")
	})

	select {
	case res := <-c:
		return res.Val, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

type discoveryKey struct {
	IRI       blob.IRI
	Version   blob.Version
	Recursive bool
}

func loadRBSRStore(conn *sqlite.Conn, dkeys map[discoveryKey]struct{}, store rbsr.Store) error {
	if err := ensureTempTable(conn, "rbsr_iris"); err != nil {
		return err
	}

	if err := ensureTempTable(conn, "rbsr_blobs"); err != nil {
		return err
	}

	// Fill IRIs.
	for dkey := range dkeys {
		{
			if err := sqlitex.Exec(conn, `INSERT OR IGNORE INTO rbsr_iris
			SELECT id FROM resources WHERE iri = :iri;`, nil, string(dkey.IRI)); err != nil {
				return err
			}

			if dkey.Recursive {
				if err := sqlitex.Exec(conn, `INSERT OR IGNORE INTO rbsr_iris
				SELECT id FROM resources WHERE iri GLOB :pattern`, nil, string(dkey.IRI)+"/*"); err != nil {
					return err
				}
			}
		}
	}

	// Fill Refs.
	{
		const q = `INSERT OR IGNORE INTO rbsr_blobs
			SELECT sb.id
			FROM structural_blobs sb
			LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
			WHERE resource IN rbsr_iris
			AND type = 'Ref'
			GROUP BY resource, COALESCE(sb.extra_attrs->>'generation', 0), author
			HAVING COALESCE(sb.extra_attrs->>'generation', 0) = MAX(COALESCE(sb.extra_attrs->>'generation', 0))
				AND sb.ts = MAX(sb.ts);`

		if err := sqlitex.Exec(conn, q, nil); err != nil {
			return err
		}
	}

	// Fill Changes based on Refs.
	{
		const q = `WITH RECURSIVE
			changes (id) AS (
			    SELECT target
			    FROM blob_links bl
			    JOIN rbsr_blobs rb ON rb.id = bl.source
			        AND bl.type = 'ref/head'
			    UNION
			    SELECT target
			    FROM blob_links bl
			    JOIN changes c ON c.id = bl.source
			        AND bl.type = 'change/dep'
			)
			INSERT OR IGNORE INTO rbsr_blobs
			SELECT id FROM changes;`

		if err := sqlitex.Exec(conn, q, nil); err != nil {
			return err
		}
	}

	// Fill Capabilities and Comments.
	{
		const q = `INSERT OR IGNORE INTO rbsr_blobs
			SELECT sb.id
			FROM structural_blobs sb
			LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
			WHERE resource IN rbsr_iris
			AND sb.type IN ('Capability', 'Comment')`

		if err := sqlitex.Exec(conn, q, nil); err != nil {
			return err
		}
	}

	// Load blobs.
	{
		const q = `SELECT
				sb.ts,
				b.codec,
				b.multihash
			FROM rbsr_blobs rb
			CROSS JOIN structural_blobs sb ON sb.id = rb.id
			CROSS JOIN blobs b INDEXED BY blobs_metadata ON b.id = sb.id
			ORDER BY sb.ts;`

		if err := sqlitex.Exec(conn, q, func(row *sqlite.Stmt) error {
			inc := sqlite.NewIncrementor(0)
			var (
				ts    = row.ColumnInt64(inc())
				codec = row.ColumnInt64(inc())
				hash  = row.ColumnBytes(inc())
			)
			c := cid.NewCidV1(uint64(codec), hash)

			return store.Insert(ts, strbytes.Bytes(c.KeyString()))
		}); err != nil {
			return err
		}
	}

	return nil
}

func ensureTempTable(conn *sqlite.Conn, name string) error {
	err := sqlitex.Exec(conn, "DELETE FROM "+name, nil)
	if err == nil {
		return nil
	}

	return sqlitex.Exec(conn, "CREATE TEMP TABLE "+name+" (id INTEGER PRIMARY KEY);", nil)
}

func (s *Service) checkVersionExists(conn *sqlite.Conn, lookup *blob.LookupCache) {

}

var qGetEntity = dqb.Str(`
	SELECT
		iri
	FROM resources
	WHERE iri = :iri
	LIMIT 1;
`)

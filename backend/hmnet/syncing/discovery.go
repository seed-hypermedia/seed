package syncing

import (
	"context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	docspb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hmnet/netutil"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/ipfs"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/strbytes"
	"strings"
	"sync/atomic"
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

// DiscoveryProgress is used to track the progress of the discovery process.
type DiscoveryProgress struct {
	PeersFound      atomic.Int32
	PeersSyncedOK   atomic.Int32
	PeersFailed     atomic.Int32
	BlobsDiscovered atomic.Int32
	BlobsDownloaded atomic.Int32
	BlobsFailed     atomic.Int32
}

// DiscoverObject discovers an object in the network. If not found, then it returns an error
// If found, this function will store the object locally so that it can be gotten like any
// other local object. This function blocks until either success or fails to find providers.
func (s *Service) DiscoverObject(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool) (blob.Version, error) {
	prog := &DiscoveryProgress{}
	return s.DiscoverObjectWithProgress(ctx, entityID, version, recursive, prog)
}

// DiscoverObjectWithProgress is similar to DiscoverObject, but tracks the progress of the discovery process.
func (s *Service) DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, prog *DiscoveryProgress) (blob.Version, error) {
	if s.cfg.NoDiscovery {
		return "", fmt.Errorf("remote content discovery is disabled")
	}

	if s.resources == nil {
		return "", fmt.Errorf("resource API is not set")
	}
	ctxLocalPeers, cancel := context.WithTimeout(ctx, DefaultSyncingTimeout)
	defer cancel()
	c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(entityID))
	if err != nil {
		return "", fmt.Errorf("Couldn't encode eid into CID: %w", err)
	}

	vstr := version.String()

	iri := string(entityID)
	if vstr != "" {
		iri += "?v=" + vstr
	}

	if version != "" {
		res, err := s.resources.GetResource(ctxLocalPeers, &docspb.GetResourceRequest{
			Iri: iri,
		})
		if err == nil && res.Version == vstr {
			s.log.Debug("It's your lucky day, the document was already in the db!. we avoided syncing with peers.")
			return blob.Version(res.Version), nil
		}
	}

	subsMap := make(subscriptionMap)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	if err = s.db.WithSave(ctxLocalPeers, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qListPeersWithPid(), func(stmt *sqlite.Stmt) error {
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
		})
	}); err != nil {
		return "", err
	}

	// Create RBSR store once for reuse across all peers.
	dkeys := colx.HashSet[discoveryKey]{
		discoveryKey{
			IRI:       entityID,
			Version:   version,
			Recursive: recursive,
		}: {},
	}

	store, err := s.loadStore(ctxLocalPeers, dkeys)
	if err != nil {
		return "", fmt.Errorf("failed to create RBSR store: %w", err)
	}

	if len(allPeers) != 0 {
		s.log.Debug("Discovering via connected local peers first", zap.Error(err))
		eidsMap := make(map[string]bool)
		eidsMap[string(entityID)] = recursive
		for _, pid := range allPeers {
			// TODO(juligasa): look into the providers store who has each eid
			// instead of pasting all peers in all documents.
			subsMap[pid] = eidsMap
		}

		res := s.syncWithManyPeers(ctxLocalPeers, subsMap, store, prog)
		if res.NumSyncOK > 0 {
			doc, err := s.resources.GetResource(ctxLocalPeers, &docspb.GetResourceRequest{
				Iri: iri,
			})
			if err == nil && (version == "" || doc.Version == vstr) {
				s.log.Debug("Discovered content via local peer, we avoided hitting the DHT!")
				return blob.Version(doc.Version), nil
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
		return "", nil
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

	res := s.syncWithManyPeers(ctxDHT, subsMap, store, prog)
	if res.NumSyncOK > 0 {
		doc, err := s.resources.GetResource(ctxDHT, &docspb.GetResourceRequest{
			Iri: iri,
		})
		if err == nil && (version == "" || doc.Version == vstr) {
			s.log.Debug("Discovered content via DHT")
			return blob.Version(doc.Version), nil
		}
	}
	return "", fmt.Errorf("Found some DHT providers but could not get document from them %s", c.String())
}

// loadStore creates and populates an RBSR store for the given discovery keys.
func (s *Service) loadStore(ctx context.Context, dkeys map[discoveryKey]struct{}) (rbsr.Store, error) {
	store := rbsr.NewSliceStore()

	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return nil, err
	}

	if err := store.Seal(); err != nil {
		return nil, err
	}

	return store, nil
}

type discoveryKey struct {
	IRI       blob.IRI
	Version   blob.Version
	Recursive bool
}

func loadRBSRStore(conn *sqlite.Conn, dkeys map[discoveryKey]struct{}, store rbsr.Store) error {
	// List of data to sync here https://seedteamtalks.hyper.media/discussions/things-to-sync-when-pushing-to-a-server?v=bafy2bzacebddt2wpn4vxfqc7zxqvxbq32tyjne23eirpn62vvqo2ce72mjf3g&l

	if err := ensureTempTable(conn, "rbsr_iris"); err != nil {
		return err
	}

	if err := ensureTempTable(conn, "rbsr_blobs"); err != nil {
		return err
	}

	if err := fillTables(conn, dkeys); err != nil {
		return err
	}

	var linkIRIs = make(map[discoveryKey]struct{})
	// Fill Links.
	{
		const q = `
			WITH genesis (id) AS (
				SELECT distinct genesis_blob FROM resources WHERE id IN rbsr_iris
			), linked_changes (id) AS (
				SELECT id FROM structural_blobs WHERE genesis_blob IN (SELECT id FROM genesis)
				UNION ALL
				SELECT id from genesis
			)
			SELECT r.iri,
			rl.is_pinned,
			rl.extra_attrs->>'v' AS version
			FROM resources r
			JOIN resource_links rl ON r.id = rl.target
			WHERE rl.source IN linked_changes
			GROUP BY r.iri, version, rl.is_pinned;`

		if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
			var iri = blob.IRI(stmt.ColumnText(0))
			var version = blob.Version(stmt.ColumnText(2))
			var isPinned = stmt.ColumnInt(1) != 0
			dKey := discoveryKey{IRI: iri, Version: "", Recursive: false}
			if isPinned && version != "" {
				// If it's pinned, we want to make sure we get the specific version.
				dKey = discoveryKey{IRI: iri, Version: version, Recursive: false}
			}
			linkIRIs[dKey] = struct{}{}
			return nil
		}); err != nil {
			return err
		}
	}
	// Fill Citations.
	{
		if err := sqlitex.ExecTransient(conn, listCitations(), func(stmt *sqlite.Stmt) error {
			var (
				author    = core.Principal(stmt.ColumnBytesUnsafe(0)).String()
				tsid      = blob.TSID(stmt.ColumnText(1))
				isDeleted = stmt.ColumnText(2) == "1"
				source    = stmt.ColumnText(3)
				blobType  = stmt.ColumnText(4)
			)

			if blobType == "Comment" {
				source = "hm://" + author + "/" + tsid.String()
			}
			if isDeleted {
				return nil
			}
			dKey := discoveryKey{IRI: blob.IRI(source)}
			linkIRIs[dKey] = struct{}{}
			return nil
		}); err != nil {
			return err
		}
	}
	if err := fillTables(conn, linkIRIs); err != nil {
		return err
	}
	// Find recursively all the agent capabilities for authors of the blobs we've currently selected,
	// until we can't find any more.
	for {
		blobCountBefore, err := sqlitex.QueryOne[int](conn, "SELECT count() FROM rbsr_blobs;")
		if err != nil {
			return err
		}

		if blobCountBefore == 0 {
			break
		}

		const q = `
			INSERT OR IGNORE INTO rbsr_blobs
			SELECT id
			FROM structural_blobs sb
			WHERE sb.type = 'Capability'
			AND sb.extra_attrs->>'del' IN (
				SELECT DISTINCT author
				FROM structural_blobs
				WHERE id IN rbsr_blobs
			)
			AND sb.extra_attrs->>'role' = 'AGENT';`

		if err := sqlitex.Exec(conn, q, nil); err != nil {
			return err
		}

		blobCountAfter, err := sqlitex.QueryOne[int](conn, "SELECT count() FROM rbsr_blobs;")
		if err != nil {
			return err
		}

		if blobCountAfter == blobCountBefore {
			break
		}
	}

	// Load blobs.
	{
		const q = `SELECT
				sb.ts,
				b.codec,
				b.multihash
			FROM rbsr_blobs rb
			CROSS JOIN public_blobs pb ON pb.id = rb.id
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

func fillTables(conn *sqlite.Conn, dkeys map[discoveryKey]struct{}) error {
	// Fill IRIs.
	for dkey := range dkeys {
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

		space, path, err := dkey.IRI.SpacePath()
		if err != nil {
			return err
		}

		// TODO(burdiyan): currently in our database we don't treat comments and other snapshot resources as resources.
		// Instead comments belong to the document they target, which is different from how we think about them now —
		// we now think about them as their own state-based resources.
		// So here we implement a bit of a naughty workaround, to include the blobs into the syncing dataset
		// if the requested path looks like a TSID of a state-based resource.
		// We should refactor our database to treat comments as resources and remove this workaround in the future.
		if tsid, ok := parseTSIDPath(path); ok {
			const q = `INSERT OR IGNORE INTO rbsr_blobs
				SELECT id
				FROM structural_blobs
				WHERE extra_attrs->>'tsid' = :tsid
				AND author = (SELECT id FROM public_keys WHERE principal = :principal);`
			if err := sqlitex.Exec(conn, q, nil, tsid, []byte(space)); err != nil {
				return err
			}
		}
	}
	/*
		// Follow all the redirect targets recursively.
		{
			const q = `WITH RECURSIVE t (id) AS (
					SELECT * FROM rbsr_iris
					UNION
					SELECT resources.id
					FROM structural_blobs sb, resources, t
					WHERE (t.id = sb.resource AND sb.type = 'Ref')
					AND sb.extra_attrs->>'redirect' IS NOT NULL
					AND sb.extra_attrs->>'redirect' = resources.iri
				)
				SELECT * FROM t;`

			// TODO(burdiyan): this query doesn't do anything, I forget why it's here.
		}
	*/
	// Fill Refs.
	{
		const q = `INSERT OR IGNORE INTO rbsr_blobs
				SELECT sb.id
				FROM structural_blobs sb
				LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
				WHERE resource IN rbsr_iris
				AND type = 'Ref'`

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

	// Fill Capabilities and the rest of the related blob types.
	{
		const q = `INSERT OR IGNORE INTO rbsr_blobs
				SELECT sb.id
				FROM structural_blobs sb
				LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
				WHERE resource IN rbsr_iris
				AND sb.type IN ('Capability', 'Comment', 'Profile', 'Contact')`

		if err := sqlitex.Exec(conn, q, nil); err != nil {
			return err
		}
	}
	return nil
}

func parseTSIDPath(path string) (tsid blob.TSID, ok bool) {
	if path == "" {
		return "", false
	}

	if path[0] != '/' {
		panic("isPathTSID: BUG: path doesn't have leading slash")
	}

	maybeTSID := path[1:]
	l := len(maybeTSID)

	if l < blob.MinTSIDLength || l > blob.MaxTSIDLength {
		return "", false
	}

	if _, _, err := blob.TSID(maybeTSID).Parse(); err != nil {
		return "", false
	}

	return blob.TSID(maybeTSID), true
}

func ensureTempTable(conn *sqlite.Conn, name string) error {
	err := sqlitex.Exec(conn, "DELETE FROM "+name, nil)
	if err == nil {
		return nil
	}

	return sqlitex.Exec(conn, "CREATE TEMP TABLE "+name+" (id INTEGER PRIMARY KEY);", nil)
}

var qGetEntity = dqb.Str(`
	SELECT
		iri
	FROM resources
	WHERE iri = :iri
	LIMIT 1;
`)

var listCitations = dqb.Str(`
SELECT distinct
	public_keys.principal AS main_author,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	structural_blobs.extra_attrs->>'deleted' as is_deleted,
	r.iri AS source_iri,
	structural_blobs.type AS blob_type
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources r
  ON r.genesis_blob = CASE
        WHEN structural_blobs.type != 'Change' THEN structural_blobs.genesis_blob
        ELSE coalesce(structural_blobs.genesis_blob, structural_blobs.id)
     END
WHERE resource_links.target IN rbsr_iris;
`)

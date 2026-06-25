// Package syncing provides functionality for P2P syncing and discovery of data.
package syncing

import (
	"context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	docspb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hmnet/netutil"
	"seed/backend/ipfs"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/multiformats/go-multicodec"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// DefaultDiscoveryTimeout is how long do we wait to discover a peer and sync with it.
const (
	DefaultDiscoveryTimeout = time.Second * 60 * 10 // 10 minutes
	DefaultSyncingTimeout   = 2 * DefaultDiscoveryTimeout / 3
	DefaultDHTTimeout       = 1 * DefaultDiscoveryTimeout / 3
)

// Progress is used to track the progress of the discovery process.
type Progress struct {
	PeersFound      atomic.Int32
	PeersSyncedOK   atomic.Int32
	PeersFailed     atomic.Int32
	BlobsDiscovered atomic.Int32
	BlobsDownloaded atomic.Int32
	BlobsFailed     atomic.Int32

	// Diagnostic counters for attributing why a discovery is cut
	// before convergence. MaxReconciledWants is the largest single-peer reconciled
	// want-count seen this discovery — against a complete peer (the gateway) this
	// approximates the full set, so `MaxReconciledWants - BlobsDownloaded` is the
	// outstanding work at any moment. EmptyPeers/ReconciledPeers expose whether the
	// straggler quorum is being satisfied by content-less peers.
	MaxReconciledWants atomic.Int32
	EmptyPeers         atomic.Int32
	ReconciledPeers    atomic.Int32
}

// recordReconcile folds one peer's reconciled want-count into the diagnostic
// tally. Safe for concurrent callers (one per peer goroutine).
func (p *Progress) recordReconcile(wants int) {
	p.ReconciledPeers.Add(1)
	if wants == 0 {
		p.EmptyPeers.Add(1)
	}
	w := int32(wants) //nolint:gosec
	for {
		cur := p.MaxReconciledWants.Load()
		if w <= cur || p.MaxReconciledWants.CompareAndSwap(cur, w) {
			return
		}
	}
}

// NewDiscoveryProgress creates a progress tracker with an initialized notification channel.
func NewDiscoveryProgress() *Progress {
	return &Progress{}
}

// DiscoverObject discovers an object in the network. If not found, then it returns an error
// If found, this function will store the object locally so that it can be gotten like any
// other local object. This function blocks until either success or fails to find providers.
//
// blobTypes is an optional allowlist of structural blob types to discover
// (e.g. ["Profile", "Ref", "Change"]). When nil/empty, all blob types are
// discovered (default). Filtering avoids pulling unrelated blobs (e.g.
// Capability/Comment/Contact) when the caller only needs a subset — useful
// for "render an avatar" use-cases.
//
// recursive and depthOne are mutually exclusive: recursive walks the entire
// subtree below entityID, depthOne only its direct children.
func (s *Service) DiscoverObject(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string) (blob.Version, error) {
	prog := NewDiscoveryProgress()
	return s.DiscoverObjectWithProgress(ctx, entityID, version, recursive, depthOne, blobTypes, prog)
}

// docStructureTypes is the blob-type allowlist for the root-first discovery
// phases: just the document itself (its version Refs and change history). It
// deliberately excludes Comment so the page text assembles fast without dragging
// in the thousands of comment blobs that share the dag-cbor structure tier; the
// doc's display media still arrives via the media link-walk, and comments come
// with the full recursive phase.
var docStructureTypes = []string{"Ref", "Change"}

// DiscoverObjectWithProgress is similar to DiscoverObject, but tracks the progress of the discovery process.
func (s *Service) DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string, prog *Progress) (resultVersion blob.Version, resultErr error) {
	if s.cfg.NoDiscovery {
		return "", fmt.Errorf("remote content discovery is disabled")
	}

	discoverStart := time.Now()
	outcome := "notfound"
	defer func() {
		if resultErr != nil {
			outcome = "error"
		}
		dur := time.Since(discoverStart)
		MDiscoverTotalSeconds.WithLabelValues(outcome).Observe(dur.Seconds())
	}()

	ctxLocalPeers, cancel := context.WithTimeout(ctx, DefaultSyncingTimeout)
	defer cancel()
	c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(entityID))
	if err != nil {
		return "", fmt.Errorf("couldn't encode eid into CID: %w", err)
	}

	vstr := version.String()

	iri := string(entityID)
	if vstr != "" {
		iri += "?v=" + vstr
	}

	if version != "" && s.resources != nil {
		res, err := s.resources.GetResource(ctxLocalPeers, &docspb.GetResourceRequest{
			Iri: iri,
		})
		if err == nil && res.Version == vstr {
			s.log.Debug("It's your lucky day, the document was already in the db!. we avoided syncing with peers.")
			return blob.Version(res.Version), nil
		}
	}

	// Observability: the phase-boundary checks below only sample GetResource at
	// coarse points (P0/P1/P2 ends, which include the straggler idle grace). Poll
	// it directly so the log records when the resource first becomes renderable —
	// the user-facing latency we care about — regardless of which phase delivered
	// the closure. Cheap read; stops on first success, ctx end, function return,
	// or a 60s cap. Recursive (subscription) discoveries only.
	if recursive && s.resources != nil {
		pollerDone := make(chan struct{})
		defer close(pollerDone)
		go func() {
			tick := time.NewTicker(250 * time.Millisecond)
			defer tick.Stop()
			limit := time.NewTimer(60 * time.Second)
			defer limit.Stop()
			for {
				select {
				case <-pollerDone:
					return
				case <-ctx.Done():
					return
				case <-limit.C:
					return
				case <-tick.C:
					if _, gerr := s.resources.GetResource(ctx, &docspb.GetResourceRequest{Iri: string(entityID)}); gerr == nil {
						return
					}
				}
			}
		}()
	}

	subsMap := make(subscriptionMap)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	seenPeers := make(map[peer.ID]struct{})
	addPeer := func(pid peer.ID) {
		if pid == "" {
			return
		}
		if _, ok := seenPeers[pid]; ok {
			return
		}
		seenPeers[pid] = struct{}{}
		allPeers = append(allPeers, pid)
	}
	peerSelectStart := time.Now()
	// targetDiscoveryPeers is the fan-out we want from syncWithManyPeers.
	// Currently-connected peers count first; if we have fewer than this,
	// we backfill from the most-recently-active stored peers.
	const targetDiscoveryPeers = 30
	livePeerSupportsProtocol := func(pid peer.ID) bool {
		if s.pc.checker == nil {
			return true
		}
		protos, err := s.host.Peerstore().GetProtocols(pid)
		if err != nil || len(protos) == 0 {
			return false
		}
		return s.pc.checker(ctxLocalPeers, pid, s.pc.version, protos...) == nil
	}
	// Live libp2p connections are the source of truth for immediate
	// discovery. The peers table is updated asynchronously by peerWriter after
	// Connect/Identify, so a caller can ForceConnect and then DiscoverEntity
	// before the row is committed. We still require already-known protocol
	// support before using a live peer: unsupported/unknown peers are skipped
	// here and can be retried by the hot-task scheduler once Identify catches
	// up or by the persisted peers-table path after the protocol hook stores
	// them.
	for _, pid := range s.host.Network().Peers() {
		if !livePeerSupportsProtocol(pid) {
			continue
		}
		addPeer(pid)
	}
	// Step 1 — covering-index scan over peers.pid (no addresses, no other
	// columns). This stays on the unique pid index — verified by EXPLAIN —
	// so it doesn't touch the main rowid btree or the fat addresses overflow
	// pages that drove the prior 187 ms hold on this statement.
	var fallbackCandidates []string
	if err = s.db.WithSave(ctxLocalPeers, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qListPeerIDs(), func(stmt *sqlite.Stmt) error {
			pid := stmt.ColumnText(0)
			peerID, decodeErr := peer.Decode(pid)
			if decodeErr != nil {
				s.log.Warn("Malformed peer ID in peers table", zap.String("PID", pid), zap.Error(decodeErr))
				return nil
			}
			if s.host.Network().Connectedness(peerID) == network.Connected {
				addPeer(peerID)
				return nil
			}
			if _, ok := seenPeers[peerID]; ok {
				return nil
			}
			// Collect every disconnected pid so step 2's
			// ORDER BY updated_at DESC picks the freshest from
			// the full pool, not just the first scan-order N.
			// 1100 placeholders is well within SQLite's
			// SQLITE_MAX_VARIABLE_NUMBER (32766).
			fallbackCandidates = append(fallbackCandidates, pid)
			return nil
		})
	}); err != nil {
		MDiscoverPhaseSeconds.WithLabelValues("peer_select").Observe(time.Since(peerSelectStart).Seconds())
		return "", err
	}

	// Step 2 — only if we don't have enough connected peers to hit the
	// target. Fetch addresses for the most-recently-active fallback set
	// (one batched query, PK-indexed filter, in-memory sort over the
	// small candidate list). Connected peers don't need addresses from
	// the DB — libp2p already has them in Peerstore.
	if need := targetDiscoveryPeers - len(allPeers); need > 0 && len(fallbackCandidates) > 0 {
		args := make([]any, 0, len(fallbackCandidates)+1)
		placeholders := make([]string, len(fallbackCandidates))
		for i, p := range fallbackCandidates {
			placeholders[i] = "?"
			args = append(args, p)
		}
		args = append(args, need)
		q := "SELECT addresses, pid FROM peers " +
			"WHERE pid IN (" + strings.Join(placeholders, ",") + ") " +
			"ORDER BY updated_at DESC LIMIT ?;"
		if err = s.db.WithSave(ctxLocalPeers, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
				addrsStr := stmt.ColumnText(0)
				pid := stmt.ColumnText(1)
				info, parseErr := netutil.AddrInfoFromStrings(strings.Split(addrsStr, ",")...)
				if parseErr != nil {
					s.log.Warn("Can't discover from peer since it has malformed addresses", zap.String("PID", pid), zap.Error(parseErr))
					return nil
				}
				s.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
				addPeer(info.ID)
				return nil
			}, args...)
		}); err != nil {
			MDiscoverPhaseSeconds.WithLabelValues("peer_select").Observe(time.Since(peerSelectStart).Seconds())
			return "", err
		}
	}
	MDiscoverPhaseSeconds.WithLabelValues("peer_select").Observe(time.Since(peerSelectStart).Seconds())

	// buildStore loads the local RBSR set (the blobs we already have) for a
	// given scope, so each sync phase reconciles against the right slice of the
	// subtree. Reused for the root-first depthOne phase and the full scope.
	buildStore := func(ctx context.Context, scope entityScope, btypes []string) (*authorizedStore, error) {
		dkeys := colx.HashSet[DiscoveryKey]{
			DiscoveryKey{
				IRI:       entityID,
				Version:   version,
				Recursive: scope.Recursive,
				DepthOne:  scope.DepthOne,
				BlobTypes: BlobTypesString(btypes),
			}: {},
		}
		st := newAuthorizedStore()
		// WithSaveTempOnly: loadRBSRStore writes only to TEMP tables
		// (rbsr_iris / rbsr_blobs / rbsr_authorized_spaces). These don't take
		// the main-DB writer mutex, so this scope is excluded from
		// /debug/sqlite's writer-slot sections — the real bitswap-write scopes
		// later in DiscoverObjectWithProgress still use WithSave/WithTx and are
		// tracked normally. See SaveTempOnly contract.
		if err := s.db.WithSaveTempOnly(ctx, func(conn *sqlite.Conn) error {
			// Client-side RBSR: include all local blobs (nil = no filter).
			return loadRBSRStore(conn, dkeys, st)
		}); err != nil {
			return nil, fmt.Errorf("failed to load RBSR store: %w", err)
		}
		if err := st.Seal(); err != nil {
			return nil, fmt.Errorf("failed to seal RBSR store: %w", err)
		}
		return st, nil
	}

	store, err := buildStore(ctxLocalPeers, entityScope{Recursive: recursive, DepthOne: depthOne}, blobTypes)
	if err != nil {
		return "", err
	}

	// Compute auth info once for all peers. This determines which siteURL servers
	// we should authenticate with based on local siteURL and capability info.
	eidsMap := make(map[string]entityScope)
	eidsMap[string(entityID)] = entityScope{Recursive: recursive, DepthOne: depthOne}
	auth := s.computeAuthInfo(ctxLocalPeers, eidsMap)

	// syncConnected reconciles one scope against every connected + auth peer and
	// records the phase timing. Used for the root-first depthOne pass and the
	// full-scope pass below.
	syncConnected := func(ctx context.Context, phase string, scope entityScope, btypes []string, st *authorizedStore) SyncResult {
		eids := map[string]entityScope{string(entityID): scope}
		peers := make(subscriptionMap, len(allPeers))
		for _, pid := range allPeers {
			// TODO(juligasa): look into the providers store who has each eid
			// instead of pasting all peers in all documents.
			peers[pid] = eids
		}
		// Include siteUrl peers into the set we sync.
		for pid := range auth.peerKeys {
			if _, ok := peers[pid]; !ok {
				peers[pid] = eids
			}
		}
		start := time.Now()
		// The root-directory pass only needs to make the page renderable before
		// handing off to connected_sync (which fetches the full recursive closure),
		// so it drops stragglers at the grace instead of keep-draining a backlog the
		// next phase will fetch anyway.
		quickDrain := phase == "root_directory_sync"
		res := s.syncWithManyPeers(ctx, peers, st, prog, auth, btypes, quickDrain)
		MDiscoverPhaseSeconds.WithLabelValues(phase).Observe(time.Since(start).Seconds())
		return res
	}

	if len(allPeers) != 0 {
		s.log.Debug("Discovering via already-connected peers first")

		// Root-first directory pass: for a recursive discovery, first reconcile
		// depthOne with only the document structure (docStructureTypes: Ref +
		// Change) and no bulk media (StructureOnly). That is the home plus its
		// direct children's titles/covers — a few hundred blobs — so the home AND
		// its directory of cards (the actual home view) assemble in a few seconds,
		// fetched structure-first and streamed, while the full subtree (comments,
		// comment counts, deep descendants and GiBs of media) streams in P2 behind
		// it. Excluding Comment matters: a busy home page carries 2k+ comments
		// that share the dag-cbor structure tier and would otherwise bury the
		// directory's blobs.
		//
		// We deliberately do NOT run a separate non-recursive pass before this:
		// depthOne is a superset of the home, so a serial non-recursive phase only
		// delayed the directory (the view the user is waiting for) by its own
		// completion wait without making the page appear any sooner.
		//
		// Skipped when the caller already narrowed blobTypes (e.g. an avatar
		// fetch); that path goes straight to its single scoped sync below.
		if len(blobTypes) == 0 && recursive {
			dirScope := entityScope{DepthOne: true, StructureOnly: true}
			if dStore, derr := buildStore(ctxLocalPeers, dirScope, docStructureTypes); derr != nil {
				s.log.Debug("root-first directory store load failed", zap.Error(derr))
			} else {
				syncConnected(ctxLocalPeers, "root_directory_sync", dirScope, docStructureTypes, dStore)
			}
		}

		// Full requested scope (all types: comments, comment counts, all media, bulk).
		res := syncConnected(ctxLocalPeers, "connected_sync", entityScope{Recursive: recursive, DepthOne: depthOne}, blobTypes, store)
		if res.NumSyncOK > 0 && s.resources != nil {
			doc, err := s.resources.GetResource(ctxLocalPeers, &docspb.GetResourceRequest{
				Iri: iri,
			})
			if err == nil && (version == "" || doc.Version == vstr) {
				s.log.Debug("Discovered content via an already-connected peer, we avoided hitting the DHT!")
				outcome = "connected"
				return blob.Version(doc.Version), nil
			}
		}
	}
	s.log.Debug("None of the connected peers have the document, hitting the DHT :(")
	// Arbitrary number of maximum providers
	maxProviders := 15

	// If we are looking for a specific version, we don't need to limit the number of providers,
	// because we will short-circuit as soon as we found the desired version.
	if version != "" {
		maxProviders = 0
	}
	ctxDHT, cancelDHTCtx := context.WithTimeout(ctx, DefaultDHTTimeout)
	defer cancelDHTCtx()
	dhtDiscoverStart := time.Now()
	peers := s.bitswap.FindProvidersAsync(ctxDHT, c, maxProviders)
	if len(peers) == 0 {
		MDiscoverPhaseSeconds.WithLabelValues("dht_discover").Observe(time.Since(dhtDiscoverStart).Seconds())
		return "", nil
	}

	eidsMap = make(map[string]entityScope)
	eidsMap[string(entityID)] = entityScope{Recursive: recursive, DepthOne: depthOne}
	subsMap = make(subscriptionMap)
	for p := range peers {
		p := p
		// TODO(juligasa): look into the providers store who has each eid
		// instead of pasting all peers in all documents.
		subsMap[p.ID] = eidsMap
	}
	MDiscoverPhaseSeconds.WithLabelValues("dht_discover").Observe(time.Since(dhtDiscoverStart).Seconds())

	dhtSyncStart := time.Now()
	// DHT sync is the last-resort bulk phase (no follow-up), so it keeps draining.
	res := s.syncWithManyPeers(ctxDHT, subsMap, store, prog, auth, blobTypes, false)
	MDiscoverPhaseSeconds.WithLabelValues("dht_sync").Observe(time.Since(dhtSyncStart).Seconds())
	if res.NumSyncOK > 0 && s.resources != nil {
		doc, err := s.resources.GetResource(ctxDHT, &docspb.GetResourceRequest{
			Iri: iri,
		})
		if err == nil && (version == "" || doc.Version == vstr) {
			s.log.Debug("Discovered content via DHT")
			outcome = "dht"
			return blob.Version(doc.Version), nil
		}
	}
	return "", fmt.Errorf("found some DHT providers but could not get document from them %s", c.String())
}

// DiscoveryKey is used to identify resources to discover.
type DiscoveryKey struct {
	// IRI is the identifier of the resource.
	IRI blob.IRI

	// Version is the specific version of the resource to discover.
	Version blob.Version

	// Recursive indicates whether to discover the entire subtree below the IRI.
	// Mutually exclusive with DepthOne.
	Recursive bool

	// DepthOne indicates whether to discover only the direct children of the IRI
	// (one level deep, no further descent). Mutually exclusive with Recursive.
	DepthOne bool

	// BlobTypes is a sorted, comma-joined allowlist of structural blob types
	// to include during discovery (e.g. "Change,Profile,Ref"). Empty means
	// no filter — all blob types are discovered (default behavior).
	// Stored as a string (not a slice) so DiscoveryKey remains hashable for use as a map key.
	// Use [BlobTypesString] to construct it from a slice.
	BlobTypes string
}

// BlobTypesString canonicalizes a list of blob-type names for storage in
// [DiscoveryKey.BlobTypes]: it deduplicates, sorts, and comma-joins them.
// Returns the empty string for a nil or empty slice (i.e. "no filter").
func BlobTypesString(types []string) string {
	if len(types) == 0 {
		return ""
	}
	seen := make(map[string]struct{}, len(types))
	out := make([]string, 0, len(types))
	for _, t := range types {
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	if len(out) == 0 {
		return ""
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

// effectiveBlobTypeFilter merges blob-type allowlists across the given dkeys.
// If any dkey has an empty BlobTypes (= no filter), the result is nil — meaning
// the caller should not apply any type filter, since at least one consumer
// asked for the full set. Otherwise returns the sorted union of requested types.
func effectiveBlobTypeFilter(dkeys map[DiscoveryKey]struct{}) []string {
	if len(dkeys) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	for dk := range dkeys {
		if dk.BlobTypes == "" {
			// Any unfiltered consumer disables the filter for this batch.
			return nil
		}
		for _, t := range strings.Split(dk.BlobTypes, ",") {
			if t != "" {
				seen[t] = struct{}{}
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	types := make([]string, 0, len(seen))
	for t := range seen {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// hasType reports whether t is in the (already-canonicalized) allowlist.
// nil/empty allowlist means "no filter" and returns true.
func hasType(allowlist []string, t string) bool {
	if len(allowlist) == 0 {
		return true
	}
	for _, x := range allowlist {
		if x == t {
			return true
		}
	}
	return false
}

// loadRBSRStore loads blobs into an RBSR store for the given discovery keys.
func loadRBSRStore(conn *sqlite.Conn, dkeys map[DiscoveryKey]struct{}, store *authorizedStore) (err error) {
	if err := collectBlobs(conn, dkeys, false); err != nil {
		return err
	}

	// Visibility encoding via CASE EXISTS: ~99 % of blobs carry a single
	// blob_visibility row with space=0 (public). The EXISTS probe is a
	// single PK lookup against the (id, space) WITHOUT ROWID PK; if it
	// hits, return the literal '[0]' and skip JSON_GROUP_ARRAY entirely.
	// Only the rare private case runs the aggregation. Semantically
	// equivalent to the previous form against the Go consumer below
	// (which iterates the array, breaks on space=0, otherwise calls
	// SetItemPrivateVisibility per non-zero space) — verified by case
	// analysis on the four input shapes: public-only, private-only,
	// both, and no rows. Drops ~10 ms cold on a 32 K-row rbsr_blobs.
	const q = `SELECT
			COALESCE(sb.ts, 0),
			b.codec,
			b.multihash,
			CASE
				WHEN EXISTS (
					SELECT 1 FROM blob_visibility
					WHERE id = b.id AND space = 0
				) THEN '[0]'
				ELSE (
					SELECT JSON_GROUP_ARRAY(space)
					FROM blob_visibility
					WHERE id = b.id
				)
			END
		FROM rbsr_blobs rb
		CROSS JOIN blobs b INDEXED BY blobs_metadata ON b.id = rb.id
		LEFT JOIN structural_blobs sb ON sb.id = b.id
		WHERE b.size >= 0
		ORDER BY sb.ts, b.multihash;`

	lookup := blob.NewLookupCache(conn)

	rows, discard, check := sqlitex.Query(conn, q).All()
	defer discard(&err)
	var i int
	for row := range rows {
		{
			inc := sqlite.NewIncrementor(0)
			var (
				ts             = row.ColumnInt64(inc())
				codec          = row.ColumnInt64(inc())
				hash           = row.ColumnBytesUnsafe(inc())
				visibilityJSON = row.ColumnTextUnsafe(inc())
			)

			c := cid.NewCidV1(uint64(codec), hash)
			if err := store.Insert(ts, unsafeutil.BytesFromString(c.KeyString())); err != nil {
				return fmt.Errorf("failed to insert blob %s into RBSR store: %w", c, err)
			}

			for _, v := range gjson.Parse(visibilityJSON).ForEach {
				vv := v.Int()
				if vv == 0 {
					// If space is 0 it means the blob is public, so don't care whether it's private for any other space.
					break
				}

				space, err := lookup.PublicKey(vv)
				if err != nil {
					return err
				}

				store.SetItemPrivateVisibility(i, space)
			}
		}
		i++
	}

	if err := check(); err != nil {
		return err
	}

	return nil
}

// CIDWithTS is a CID with its timestamp.
type CIDWithTS struct {
	Ts  int64
	CID cid.Cid
}

// GetRelatedMaterial gets all the related material CIDs for the given discovery keys.
// If authorizedSpaces is nil, all blobs are included (public and private).
// If authorizedSpaces is non-nil, only:
//   - public blobs (blob_visibility.space IS NULL), and
//   - private blobs whose space owner is in authorizedSpaces
//
// are included.
func GetRelatedMaterial(conn *sqlite.Conn, dkeys map[DiscoveryKey]struct{}, includeLinksCitationsAccounts bool, authorizedSpaces []core.Principal) (cids []CIDWithTS, err error) {
	if err := collectBlobs(conn, dkeys, includeLinksCitationsAccounts); err != nil {
		return nil, err
	}

	if err := ensureTempTable(conn, "rbsr_authorized_spaces"); err != nil {
		return nil, err
	}

	for _, space := range authorizedSpaces {
		const q = `
			INSERT OR IGNORE INTO rbsr_authorized_spaces
			SELECT id FROM public_keys WHERE principal = :space;`

		if err := sqlitex.Exec(conn, q, nil, []byte(space)); err != nil {
			return nil, err
		}
	}

	// Load blobs.
	{
		const q = `SELECT
				COALESCE(sb.ts, 0),
				b.codec,
				b.multihash
			FROM (
				-- Filter rbsr_blobs according to visibility rules.
				SELECT b.id FROM rbsr_blobs b
				JOIN blob_visibility v ON v.id = b.id
				LEFT JOIN rbsr_authorized_spaces a ON a.id = v.space
				WHERE v.space = 0 OR a.id IS NOT NULL
			) rb
			CROSS JOIN blobs b INDEXED BY blobs_metadata ON b.id = rb.id
			LEFT JOIN structural_blobs sb ON sb.id = rb.id
			WHERE b.size >= 0
			ORDER BY sb.ts, b.multihash;`

		if err := sqlitex.Exec(conn, q, func(row *sqlite.Stmt) error {
			inc := sqlite.NewIncrementor(0)
			var (
				ts    = row.ColumnInt64(inc())
				codec = row.ColumnInt64(inc())
				hash  = row.ColumnBytesUnsafe(inc())
			)
			c := cid.NewCidV1(uint64(codec), hash)
			cids = append(cids, CIDWithTS{CID: c, Ts: ts})
			return nil
		}); err != nil {
			return nil, err
		}
	}

	return cids, nil
}

func collectBlobs(conn *sqlite.Conn, dkeys map[DiscoveryKey]struct{}, includeLinksCitationsAccounts bool) (err error) {
	// List of data to sync here https://seedteamtalks.hyper.media/discussions/things-to-sync-when-pushing-to-a-server?v=bafy2bzacebddt2wpn4vxfqc7zxqvxbq32tyjne23eirpn62vvqo2ce72mjf3g&l
	if err := ensureTempTable(conn, "rbsr_iris"); err != nil {
		return err
	}

	if err := ensureTempTable(conn, "rbsr_blobs"); err != nil {
		return err
	}

	if err := fillTables(conn, dkeys, includeLinksCitationsAccounts); err != nil {
		return err
	}

	// Include inbound Contact blobs: contacts created by other accounts whose
	// subject is the discovered account. Without this, recursive discovery of
	// an account at root misses the account's followers/members because those
	// Contact blobs are anchored to the *creator's* resource, not the subject's.
	// Only applies when discovering an account root recursively and the type
	// filter allows Contact.
	if hasType(effectiveBlobTypeFilter(dkeys), "Contact") {
		for dkey := range dkeys {
			if !dkey.Recursive {
				continue
			}
			space, path, err := dkey.IRI.SpacePath()
			if err != nil || path != "" {
				continue
			}
			const q = `INSERT OR IGNORE INTO rbsr_blobs
				SELECT sb.id
				FROM structural_blobs sb INDEXED BY contacts_by_subject
				WHERE sb.type = 'Contact'
				AND sb.extra_attrs->>'subject' = (
					SELECT id FROM public_keys WHERE principal = :principal
				);`
			if err := sqlitex.Exec(conn, q, nil, []byte(space)); err != nil {
				return err
			}
		}
	}

	if includeLinksCitationsAccounts {
		var linkIRIs = make(map[DiscoveryKey]struct{})
		// Fill Links.
		{
			const q = `
				SELECT
					r.iri,
					rl.is_pinned,
					rl.extra_attrs->>'v' AS version
				FROM resources r
				JOIN resource_links rl ON r.id = rl.target
				WHERE rl.source IN rbsr_blobs
				GROUP BY r.iri, version, rl.is_pinned;`

			if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
				var iri = blob.IRI(stmt.ColumnText(0))
				var version = blob.Version(stmt.ColumnText(2))
				var isPinned = stmt.ColumnInt(1) != 0
				dKey := DiscoveryKey{IRI: iri, Version: "", Recursive: false}
				if isPinned && version != "" {
					// If it's pinned, we want to make sure we get the specific version.
					dKey = DiscoveryKey{IRI: iri, Version: version, Recursive: false}
				}
				linkIRIs[dKey] = struct{}{}
				return nil
			}); err != nil {
				return err
			}
		}

		// Fill Citations.
		{
			const q = `
				SELECT distinct
					public_keys.principal AS main_author,
					structural_blobs.extra_attrs->>'tsid' AS tsid,
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
				WHERE resource_links.target IN rbsr_iris;`
			if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
				var (
					author   = core.Principal(stmt.ColumnBytesUnsafe(0)).String()
					tsid     = blob.TSID(stmt.ColumnText(1))
					source   = stmt.ColumnText(2)
					blobType = stmt.ColumnText(3)
				)

				if blobType == "Comment" {
					source = "hm://" + author + "/" + tsid.String()
				}
				dKey := DiscoveryKey{IRI: blob.IRI(source)}
				linkIRIs[dKey] = struct{}{}
				return nil
			}); err != nil {
				return err
			}
		}
		// Fill Comment Links.
		{
			const q = `
				INSERT OR IGNORE INTO rbsr_iris
				SELECT target
				FROM resource_links
				WHERE source IN rbsr_blobs
				AND type GLOB 'comment*';`

			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		if err := fillTables(conn, linkIRIs, true); err != nil {
			return err
		}
	}

	// Find recursively all the agent capabilities for authors of the blobs
	// we've currently selected. Convergence is detected via conn.Changes()
	// after each INSERT — zero new rows means the closure is stable.
	// Avoids the two SELECT count() probes per iteration of the previous
	// design (which ran 4 INSERTs even when iter 1 already converged, since
	// it needed an explicit equality check to break).
	// Skip when the caller's type allowlist excludes Capability — without
	// Capability the recursion would never insert anything.
	if hasType(effectiveBlobTypeFilter(dkeys), "Capability") {
		// Probe once for the empty-seed case so we don't run a wasted
		// INSERT (its IN-subquery would scan all Capability rows for nothing).
		var hasAny bool
		if err := sqlitex.Exec(conn, "SELECT 1 FROM rbsr_blobs LIMIT 1;", func(*sqlite.Stmt) error {
			hasAny = true
			return nil
		}); err != nil {
			return err
		}
		if hasAny {
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

			for {
				if err := sqlitex.Exec(conn, q, nil); err != nil {
					return err
				}
				if conn.Changes() == 0 {
					break
				}
			}
		}
	}

	return nil
}

func fillTables(conn *sqlite.Conn, dkeys map[DiscoveryKey]struct{}, includeAccounts bool) error {
	typeFilter := effectiveBlobTypeFilter(dkeys)

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
		} else if dkey.DepthOne {
			if err := sqlitex.Exec(conn, `INSERT OR IGNORE INTO rbsr_iris
					SELECT id FROM resources WHERE iri GLOB :child AND iri NOT GLOB :grand`,
				nil, string(dkey.IRI)+"/*", string(dkey.IRI)+"/*/*"); err != nil {
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
	// Fill resource-scoped structural blobs (Refs + Capability + Comment +
	// Profile + Contact) in one INSERT, gated by the type allowlist. Each
	// has the same shape (WHERE resource IN rbsr_iris AND type = ?); merging
	// removes one prepare/exec round-trip and one temp-table scan compared
	// to running two same-shape INSERTs.
	//
	// Ordering note: the RECURSIVE changes block below seeds from
	// `ref/head` edges out of rbsr_blobs. Including Capability/Comment/
	// Profile/Contact entries here (rather than after the changes walk)
	// is safe — those types have no `ref/head` outgoing edges in
	// blob_links, so the seed-arm `WHERE bl.type='ref/head'` filter
	// naturally excludes them.
	{
		resourceTypes := []string{"Ref", "Capability", "Comment", "Profile", "Contact"}
		var allowed []string
		for _, t := range resourceTypes {
			if hasType(typeFilter, t) {
				allowed = append(allowed, t)
			}
		}
		if len(allowed) > 0 {
			placeholders := make([]string, len(allowed))
			args := make([]any, len(allowed))
			for i, t := range allowed {
				placeholders[i] = "?"
				args[i] = t
			}
			q := `INSERT OR IGNORE INTO rbsr_blobs
					SELECT sb.id
					FROM structural_blobs sb
					LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
					WHERE resource IN rbsr_iris
					AND sb.type IN (` + strings.Join(placeholders, ",") + `)`

			if err := sqlitex.Exec(conn, q, nil, args...); err != nil {
				return err
			}
		}
	}

	// Fill Changes based on Refs.
	// The recursive CTE walks ref/head and change/dep links, all of which
	// resolve to Change blobs — guard the whole block on Change being allowed.
	// CROSS JOIN on the seed arm forces SQLite to drive from rbsr_blobs
	// (small) and probe blob_links via its (source, type, target) PK; without
	// it the planner scans the full blob_backlinks covering index (35-359×
	// slower for typical seed sizes of 1-100 IRIs). Same pattern used at the
	// result-iteration SELECT in loadRBSRStore above.
	if hasType(typeFilter, "Change") {
		const q = `WITH RECURSIVE
				changes (id) AS (
					SELECT bl.target
					FROM rbsr_blobs rb
					CROSS JOIN blob_links bl ON bl.source = rb.id
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
	/*
		blobCountBefore, err := sqlitex.QueryOne[int](conn, "SELECT count() FROM rbsr_blobs;")
		if err != nil {
			return err
		}
	*/
	// (Refs + Capability/Comment/Profile/Contact were already filled
	// together above, before the changes RECURSIVE — see the
	// "Fill resource-scoped structural blobs" block.)

	// Fill All authors and their related blobs.
	if includeAccounts {
		// Fill All authors.
		if hasType(typeFilter, "Ref") {
			const q = `INSERT OR IGNORE INTO rbsr_blobs
					SELECT DISTINCT
					sb.id as id
					FROM resources r
					JOIN structural_blobs sb ON sb.resource = r.id
					WHERE sb.author IN (SELECT author FROM structural_blobs WHERE id IN rbsr_blobs)
					AND type = 'Ref'
					AND r.iri GLOB 'hm://*'
					AND r.iri NOT GLOB 'hm://*/*';`

			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}

		if hasType(typeFilter, "Profile") {
			const q = `INSERT OR IGNORE INTO rbsr_blobs
					SELECT sb.id
					FROM structural_blobs sb
					LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = sb.id
					WHERE sb.type = 'Profile'
					AND sb.author IN (
						SELECT DISTINCT author
						FROM structural_blobs
						WHERE id IN rbsr_blobs AND author IS NOT NULL
					);`

			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
	}

	// Fill media files (always, not just for push).
	// Uses a recursive CTE to traverse blob_links transitively along EVERY
	// link type — cross-resource chains (comment/reply-parent →
	// cross-resource Comment → comment/Image → DagPB → dagpb/chunk → Raw)
	// are real and lose media completeness if we prune by link type.
	//
	// CROSS JOIN on the seed arm forces SQLite to drive from rbsr_blobs
	// (small) and probe blob_links via its (source, type, target) PK; same
	// pattern as the RECURSIVE changes block earlier. stashed_blobs
	// anti-join is hoisted out of both recursive arms and applied only at
	// the final INSERT — that table is empty in steady state, the per-edge
	// LEFT JOIN inside the recursion is wasted work in 99 % of calls.
	{
		const q = `WITH RECURSIVE media (id) AS (
				SELECT bl.target
				FROM rbsr_blobs rb
				CROSS JOIN blob_links bl ON bl.source = rb.id
				UNION
				SELECT bl.target
				FROM blob_links bl
				JOIN media m ON m.id = bl.source
			)
			INSERT OR IGNORE INTO rbsr_blobs
			SELECT m.id
			FROM media m
			LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = m.id
			WHERE stashed_blobs.id IS NULL;`

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

// qListPeerIDs returns every known peer's PID. Stays on the unique pid
// auto-index (SCAN peers USING COVERING INDEX sqlite_autoindex_peers_1) —
// confirmed via EXPLAIN — so it never touches the main rowid btree or the
// addresses overflow pages. Hot-path query inside DiscoverObjectWithProgress.
var qListPeerIDs = dqb.Str(`
	SELECT pid FROM peers;
`)

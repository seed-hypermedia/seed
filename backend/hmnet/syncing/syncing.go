package syncing

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/ipfs"

	docspb "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/boxo/exchange"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.uber.org/zap"
)

// Metrics. This is exported as a temporary measure,
// because we have mostly the same code duplicated in groups and in syncing.
//
// TODO(burdiyan): refactor this to unify group syncing and normal periodic syncing.
var (
	MSyncingWantedBlobs = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "seed_syncing_wanted_blobs",
		Help: "Number of blobs we want to sync at this time. Same blob may be counted multiple times if it's wanted from multiple peers.",
	}, []string{"package"})

	mSyncsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncing_periodic_operations_total",
		Help: "The total number of periodic sync operations performed with peers (groups don't count).",
	})

	mSyncsInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_syncing_operations_in_flight",
		Help: "The number of periodic sync operations currently in-flight with peers (groups don't count).",
	})

	mSyncErrorsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncing_periodic_errors_total",
		Help: "The total number of errors encountered during periodic sync operations with peers (groups don't count).",
	})

	mWorkers = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_syncing_workers",
		Help: "The number of active syncing workers.",
	})

	mConnectsInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_syncing_connects_in_flight",
		Help: "Number of connection attempts in progress.",
	})

	mSyncingTickDuration = promauto.NewSummary(prometheus.SummaryOpts{
		Name: "seed_syncing_worker_tick_duration_seconds",
		Help: "Duration of a single worker tick.",
		Objectives: map[float64]float64{
			0.5:  0.05,
			0.75: 0.02,
			0.9:  0.01,
			0.99: 0.001,
		},
	})
)

// Force metric to appear even if there's no blobs to sync.
func init() {
	MSyncingWantedBlobs.WithLabelValues("syncing").Set(0)
	MSyncingWantedBlobs.WithLabelValues("groups").Set(0)
}

// netDialFunc is a function of the Seed P2P node that creates an instance
// of a Syncing RPC client for a given remote Device ID.
type netDialFunc func(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.SyncingClient, error)

// subscriptionMap is a map of peer IDs to an IRI and a boolean indicating whether it's a recursive subscription.
type subscriptionMap map[peer.ID]map[string]bool

// bitswap is a subset of the bitswap that is used by syncing service.
type bitswap interface {
	NewSession(context.Context) exchange.Fetcher
	FindProvidersAsync(context.Context, cid.Cid, int) <-chan peer.AddrInfo
}

// Subscription represents a subscription entry from the database.
type Subscription struct {
	ID        int64
	IRI       blob.IRI
	Recursive bool
	Since     time.Time
}

// ResourceAPI is an interface to retrieve resources from the local database.
type ResourceAPI interface {
	GetResource(context.Context, *docspb.GetResourceRequest) (*docspb.Resource, error)
}

// Index is the subset of the larger indexed storage
// necessary for the syncing service.
type Index interface {
	Put(context.Context, blocks.Block) error
	PutMany(context.Context, []blocks.Block) error
	GetAuthorizedSpacesForPeer(ctx context.Context, peerID peer.ID, requestedResources []blob.IRI) ([]core.Principal, error)
	GetSiteURL(ctx context.Context, space core.Principal) (string, error)
	ResolveSiteURL(ctx context.Context, siteURL string) (peer.AddrInfo, error)
	GetAuthorizedSpaces(ctx context.Context, accounts []core.Principal) ([]core.Principal, error)
}

type protocolChecker struct {
	checker func(context.Context, peer.ID, string, ...protocol.ID) error
	version string
}

// Service implements syncing content over the P2P network.
type Service struct {
	cfg        config.Syncing
	log        *zap.Logger
	db         *sqlitex.Pool
	index      Index
	bitswap    bitswap
	rbsrClient netDialFunc
	resources  ResourceAPI
	p2pClient  func(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.P2PClient, error)
	host       host.Host
	pc         protocolChecker

	keyStore core.KeyStore

	scheduler *scheduler
}

// authInfo holds pre-computed authentication information for syncing.
// It maps siteURL peer IDs to the keypairs that should authenticate with them.
type authInfo struct {
	// peerKeys maps peer IDs to keypairs that should authenticate with that peer.
	// A keypair is included only if the peer is a siteURL server for a space
	// that the keypair has access to.
	peerKeys  map[peer.ID][]*core.KeyPair
	addrInfos map[peer.ID]peer.AddrInfo
}

const peerRoutingConcurrency = 3 // how many concurrent requests for peer routing.

// P2PNode is a subset of the hmnet Node that is used by syncing service.
type P2PNode interface {
	Bitswap() *ipfs.Bitswap
	SyncingClient(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.SyncingClient, error)
	Client(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.P2PClient, error)
	Libp2p() *ipfs.Libp2p
	CheckHyperMediaProtocolVersion(ctx context.Context, pid peer.ID, desiredVersion string, protos ...protocol.ID) (err error)
	ProtocolVersion() string
}

// NewService creates a new syncing service. Users should call Start() to start the periodic syncing.
func NewService(cfg config.Syncing, log *zap.Logger, db *sqlitex.Pool, indexer Index, net P2PNode, keyStore core.KeyStore) *Service {
	svc := &Service{
		cfg:        cfg,
		log:        log,
		db:         db,
		index:      indexer,
		bitswap:    net.Bitswap(),
		rbsrClient: net.SyncingClient,
		p2pClient:  net.Client,
		host:       net.Libp2p().Host,
		keyStore:   keyStore,
	}
	svc.pc = protocolChecker{
		checker: net.CheckHyperMediaProtocolVersion,
		version: net.ProtocolVersion(),
	}

	if cfg.MinWorkers == 0 || cfg.MaxWorkers == 0 {
		panic("BUG: invalid config for syncing service")
	}

	svc.scheduler = newScheduler(svc, cfg)

	return svc
}

// SetDocGetter sets the local Doc getter when its ready.
func (s *Service) SetDocGetter(docGetter ResourceAPI) {
	s.resources = docGetter
}

// Run the syncing service which will periodically refresh subscriptions
// and ensure discovery tasks are running for each.
func (s *Service) Run(ctx context.Context) error {
	s.log.Debug("SyncingServiceStarted")

	// Load existing subscriptions from the database on startup.
	if err := s.loadSubscriptionsOnStart(ctx); err != nil {
		return err
	}

	return s.scheduler.run(ctx)
}

// loadSubscriptionsOnStart loads all existing subscriptions from the database
// and enqueues them as discovery tasks.
func (s *Service) loadSubscriptionsOnStart(ctx context.Context) error {
	subs, err := s.listSubscriptionsFromDB(ctx)
	if err != nil {
		s.log.Warn("Failed to load subscriptions on start", zap.Error(err))
		return nil
	}

	s.log.Debug("Loading subscription tasks on startup", zap.Int("count", len(subs)))

	s.scheduler.loadSubscriptions(func(yield func(DiscoveryKey) bool) {
		for _, sub := range subs {
			if !yield(DiscoveryKey{IRI: sub.IRI, Recursive: sub.Recursive}) {
				return
			}
		}
	})

	return nil
}

// Subscribe adds a subscription to the database and scheduler.
func (s *Service) Subscribe(ctx context.Context, iri blob.IRI, recursive bool) error {
	if err := s.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		const q = "INSERT OR REPLACE INTO subscriptions (iri, is_recursive) VALUES (?, ?);"
		return sqlitex.Exec(conn, q, nil, string(iri), recursive)
	}); err != nil {
		return err
	}

	// Add to scheduler.
	key := DiscoveryKey{IRI: iri, Recursive: recursive}
	s.scheduler.scheduleTask(key, time.Now(), schedOpts{forceSubscription: true})

	return nil
}

// Unsubscribe removes a subscription from the database and scheduler.
func (s *Service) Unsubscribe(ctx context.Context, iri blob.IRI) error {
	if err := s.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		const q = "DELETE FROM subscriptions WHERE iri = ?;"
		return sqlitex.Exec(conn, q, nil, string(iri))
	}); err != nil {
		return err
	}

	// The scheduler tracks by DiscoveryKey which includes recursive flag,
	// but since we're unsubscribing by IRI, we need to remove both recursive and non-recursive variants.
	s.scheduler.removeSubscriptions(
		DiscoveryKey{IRI: iri, Recursive: true},
		DiscoveryKey{IRI: iri, Recursive: false},
	)

	return nil
}

// ListSubscriptions returns all subscriptions from the database.
func (s *Service) ListSubscriptions(ctx context.Context) ([]Subscription, error) {
	return s.listSubscriptionsFromDB(ctx)
}

func (s *Service) listSubscriptionsFromDB(ctx context.Context) ([]Subscription, error) {
	var subs []Subscription
	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		const q = `SELECT id, iri, is_recursive, insert_time FROM subscriptions ORDER BY id DESC;`
		return sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
			subs = append(subs, Subscription{
				ID:        stmt.ColumnInt64(0),
				IRI:       blob.IRI(stmt.ColumnText(1)),
				Recursive: stmt.ColumnInt(2) != 0,
				Since:     time.Unix(stmt.ColumnInt64(3), 0),
			})
			return nil
		})
	}); err != nil {
		return nil, err
	}
	return subs, nil
}

// TouchHotTask returns an existing task or creates a new ephemeral one.
// If a subscription task already exists, it wakes it up and returns its info.
func (s *Service) TouchHotTask(iri blob.IRI, version blob.Version, recursive bool) TaskInfo {
	key := DiscoveryKey{IRI: iri, Version: version, Recursive: recursive}
	return s.scheduler.scheduleTask(key, time.Now(), schedOpts{isHot: true})
}

// SyncResult is a summary of one Sync loop iteration.
type SyncResult struct {
	NumSyncOK     int64
	NumSyncFailed int64
	Peers         []peer.ID
	Errs          []error
}

// syncWithManyPeers syncs with many peers in parallel.
func (s *Service) syncWithManyPeers(ctx context.Context, subsMap subscriptionMap, store *authorizedStore, prog *Progress, auth *authInfo) (res SyncResult) {
	var i int
	var wg sync.WaitGroup
	wg.Add(len(subsMap))
	res.Peers = make([]peer.ID, len(subsMap))
	res.Errs = make([]error, len(subsMap))

	for pid, eids := range subsMap {
		go func(i int, pid peer.ID, eids map[string]bool) {
			var err error
			defer func() {
				res.Errs[i] = err
				if err == nil {
					atomic.AddInt64(&res.NumSyncOK, 1)
					prog.PeersSyncedOK.Add(1)
				} else {
					atomic.AddInt64(&res.NumSyncFailed, 1)
					prog.PeersFailed.Add(1)
				}

				wg.Done()
			}()

			res.Peers[i] = pid
			s.log.Debug("Syncing with peer", zap.String("PID", pid.String()))
			if xerr := s.syncWithPeer(ctx, pid, eids, store, prog, auth); xerr != nil {
				s.log.Debug("Could not sync with content", zap.String("PID", pid.String()), zap.Error(xerr))
				err = errors.Join(err, fmt.Errorf("failed to sync objects: %w", xerr))
			}
		}(i, pid, eids)
		i++
	}

	wg.Wait()

	return res
}

func (s *Service) syncWithPeer(ctx context.Context, pid peer.ID, eids map[string]bool, store *authorizedStore, prog *Progress, auth *authInfo) error {
	// Can't sync with self.
	if s.host.Network().LocalPeer() == pid {
		s.log.Debug("Sync with self attempted")
		return fmt.Errorf("can't sync with self")
	}
	prog.PeersFound.Add(1)
	{
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.TimeoutPerPeer)
		defer cancel()
	}

	// Auto-authenticate if this peer is a siteURL server for a space we have access to.
	// We only authenticate with keys that have access to spaces where this peer is the siteURL server.
	if auth != nil {
		if keys, ok := auth.peerKeys[pid]; ok {
			for _, kp := range keys {
				if err := s.authenticateWithPeer(ctx, auth.addrInfos[pid], kp); err != nil {
					s.log.Debug("Auto-authentication failed", zap.String("account", kp.Principal().String()), zap.Error(err))
				}
			}
		}
	}

	c, err := s.rbsrClient(ctx, pid)
	if err != nil {
		return err
	}

	// Get authorized spaces for the remote peer and filter the store accordingly.
	requestedIRIs := make([]blob.IRI, 0, len(eids))
	for eid := range eids {
		requestedIRIs = append(requestedIRIs, blob.IRI(eid))
	}
	authorizedSpaces, err := s.index.GetAuthorizedSpacesForPeer(ctx, pid, requestedIRIs)
	if err != nil {
		return err
	}
	filteredStore := store.WithFilter(authorizedSpaces)

	bswap := s.bitswap.NewSession(ctx)

	return syncResources(ctx, pid, c, s.index, bswap, s.log, eids, filteredStore, prog)
}

func syncResources(
	ctx context.Context,
	pid peer.ID,
	c p2p.SyncingClient,
	idx Index,
	sess exchange.Fetcher,
	log *zap.Logger,
	eids map[string]bool,
	store rbsr.Store,
	prog *Progress,
) (err error) {
	ctx = blob.ContextWithUnreadsTracking(ctx)

	if len(eids) == 0 {
		return fmt.Errorf("syncEntities: must specify entities to sync")
	}

	mSyncsInFlight.Inc()
	defer func() {
		mSyncsInFlight.Dec()
		mSyncsTotal.Inc()
		if err != nil {
			mSyncErrorsTotal.Inc()
		}
	}()
	log = log.With(
		zap.String("peer", pid.String()),
	)
	if _, ok := ctx.Deadline(); !ok {
		return fmt.Errorf("BUG: syncEntity must have timeout")
	}

	ne, err := rbsr.NewSession(store, 50000)
	if err != nil {
		return fmt.Errorf("failed to Init Syncing Session: %w", err)
	}

	msg, err := ne.Initiate()
	if err != nil {
		return err
	}

	filters := make([]*p2p.Filter, 0, len(eids))
	for eid, recursive := range eids {
		filters = append(filters, &p2p.Filter{Resource: eid, Recursive: recursive})
	}

	var (
		allWants []cid.Cid
		wantsIdx = make(map[cid.Cid]int)
		rounds   int

		// We'll be reusing the slices for haves and wants on each round trip to reduce allocations.
		haves [][]byte
		wants [][]byte
	)
	for msg != nil {
		rounds++
		if rounds > 1000 {
			return fmt.Errorf("too many rounds of interactive syncing")
		}

		res, err := c.ReconcileBlobs(ctx, &p2p.ReconcileBlobsRequest{
			Ranges:  msg,
			Filters: filters,
		})
		if err != nil {
			return err
		}
		msg = res.Ranges

		// Clear the haves and wants from the previous round-trip.
		haves = haves[:0]
		wants = wants[:0]
		msg, err = ne.ReconcileWithIDs(msg, &haves, &wants)
		if err != nil {
			return err
		}

		for _, want := range wants {
			blockCid, err := cid.Cast(want)
			if err != nil {
				return err
			}
			prog.BlobsDiscovered.Add(1)
			wantsIdx[blockCid] = len(allWants)
			allWants = append(allWants, blockCid)
		}
		log.Debug("Blobs Reconciled", zap.Int("round", rounds), zap.Int("wants", len(allWants)))
	}

	if len(allWants) == 0 {
		log.Debug("Peer does not have new content")
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(len(allWants)))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(len(allWants)))

	downloaded := make([]blocks.Block, len(allWants))
	ch, err := sess.GetBlocks(ctx, allWants)
	if err != nil {
		return fmt.Errorf("failed to initiate bitswap session for syncing: %w", err)
	}

	download := func() {
		const idleTimeout = 40 * time.Second
		t := time.NewTimer(idleTimeout)
		defer t.Stop()

		for {
			select {
			case blk, ok := <-ch:
				if !ok {
					return
				}
				t.Reset(idleTimeout)
				downloaded[wantsIdx[blk.Cid()]] = blk
				prog.BlobsDownloaded.Add(1)
			case <-t.C:
				prog.BlobsFailed.Add(int32(len(allWants)) - prog.BlobsDownloaded.Load()) //nolint:gosec
				return
			}
		}
	}

	download()
	downloaded = slices.DeleteFunc(downloaded, func(x blocks.Block) bool { return x == nil })

	if len(downloaded) == 0 {
		return nil
	}

	if err := idx.PutMany(ctx, downloaded); err != nil {
		return fmt.Errorf("failed to put reconciled blobs: %w", err)
	}

	return nil
}

// computeAuthInfo pre-computes authentication information for syncing.
// For each space being synced:
// 1. Check if we have the space's siteURL locally.
// 2. Resolve the siteURL to a peer ID.
// 3. Check if any local key has access to that space.
// 4. If so, map the siteURL peer to the keypair.
func (s *Service) computeAuthInfo(ctx context.Context, eids map[string]bool) *authInfo {
	info := &authInfo{
		peerKeys:  make(map[peer.ID][]*core.KeyPair),
		addrInfos: make(map[peer.ID]peer.AddrInfo),
	}

	if s.keyStore == nil {
		return info
	}

	// Get all local keys.
	localKeys, err := s.keyStore.ListKeys(ctx)
	if err != nil || len(localKeys) == 0 {
		return info
	}

	// Get full keypairs for all local keys.
	localKeyPairs := make(map[string]*core.KeyPair)
	for _, namedKey := range localKeys {
		kp, err := s.keyStore.GetKey(ctx, namedKey.Name)
		if err != nil {
			continue
		}
		localKeyPairs[namedKey.Name] = kp
	}

	if len(localKeyPairs) == 0 {
		return info
	}

	// Collect unique spaces from entities being synced.
	spaces := make(map[string]core.Principal)
	for eid := range eids {
		iri := blob.IRI(eid)
		space, _, err := iri.SpacePath()
		if err != nil {
			continue
		}
		spaces[space.String()] = space
	}

	if len(spaces) == 0 {
		return info
	}

	// For each space, check siteURL and find keys with access.
	for _, space := range spaces {
		// Get siteURL for this space from local database.
		siteURL, err := s.index.GetSiteURL(ctx, space)
		if err != nil || siteURL == "" {
			// No siteURL known locally, skip.
			continue
		}

		// Resolve siteURL to peer ID.
		addrInfo, err := s.index.ResolveSiteURL(ctx, siteURL)
		if err != nil {
			continue
		}

		info.addrInfos[addrInfo.ID] = addrInfo

		// Check which local keys have access to this space.
		for _, kp := range localKeyPairs {
			authorizedSpaces, err := s.index.GetAuthorizedSpaces(ctx, []core.Principal{kp.Principal()})
			if err != nil {
				continue
			}

			for _, authSpace := range authorizedSpaces {
				if authSpace.Equal(space) {
					// This key has access to the space. Add to peerKeys.
					info.peerKeys[addrInfo.ID] = append(info.peerKeys[addrInfo.ID], kp)
					break
				}
			}
		}
	}

	return info
}

// authenticateWithPeer authenticates with a remote peer using the given keypair.
func (s *Service) authenticateWithPeer(ctx context.Context, pinfo peer.AddrInfo, kp *core.KeyPair) error {
	client, err := s.p2pClient(ctx, pinfo.ID, pinfo.Addrs...)
	if err != nil {
		return err
	}

	localPeerID := s.host.ID()
	now := time.Now().Round(blob.ClockPrecision)

	// Create ephemeral capability for authentication.
	cpb, err := blob.NewEphemeralCapability(localPeerID, kp.Principal(), pinfo.ID, now, nil)
	if err != nil {
		return err
	}

	if err := blob.Sign(kp, cpb, &cpb.Sig); err != nil {
		return err
	}

	_, err = client.Authenticate(ctx, &p2p.AuthenticateRequest{
		Account:   []byte(kp.Principal()),
		Timestamp: now.UnixMilli(),
		Signature: cpb.Sig,
	})
	return err
}

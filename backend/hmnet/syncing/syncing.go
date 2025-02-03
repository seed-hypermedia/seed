package syncing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"seed/backend/blob"
	"seed/backend/config"
	activity_proto "seed/backend/genproto/activity/v1alpha"
	documents_proto "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/netutil"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/singleflight"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"container/list"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/boxo/exchange"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multicodec"
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

	mWantedBlobsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncing_wanted_blobs_total",
		Help: "The total number of blobs we wanted to sync from a single peer sync. Same blob may be counted multiple times if it's wanted from multiple peers.",
	})

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
type netDialFunc func(context.Context, peer.ID) (p2p.SyncingClient, error)

type subscriptionMap map[peer.ID]map[string]bool

// bitswap is a subset of the bitswap that is used by syncing service.
type bitswap interface {
	NewSession(context.Context) exchange.Fetcher
	FindProvidersAsync(context.Context, cid.Cid, int) <-chan peer.AddrInfo
}
type Storage interface {
	DB() *sqlitex.Pool
	// Service manages syncing of Seed objects among peers.
}

// SubscriptionStore an interface implementing necessary methods to get subscriptions.
type SubscriptionStore interface {
	ListSubscriptions(context.Context, *activity_proto.ListSubscriptionsRequest) (*activity_proto.ListSubscriptionsResponse, error)
}

// LocalDocGetter is an interface to get a local
type LocalDocGetter interface {
	GetDocument(context.Context, *documents_proto.GetDocumentRequest) (*documents_proto.Document, error)
}

type protocolChecker struct {
	checker func(context.Context, peer.ID, string, ...protocol.ID) error
	version string
}
type Service struct {
	cfg        config.Syncing
	log        *zap.Logger
	db         *sqlitex.Pool
	indexer    blockstore.Blockstore
	bitswap    bitswap
	rbsrClient netDialFunc
	docGetter  LocalDocGetter
	p2pClient  func(context.Context, peer.ID) (p2p.P2PClient, error)
	host       host.Host
	pc         protocolChecker
	mu         sync.Mutex // Ensures only one sync loop is running at a time.
	sstore     SubscriptionStore
	wg         sync.WaitGroup
	workers    map[peer.ID]*worker
	semaphore  chan struct{}
	single     singleflight.Group[discoveryKey, blob.Version]
}

const peerRoutingConcurrency = 3 // how many concurrent requests for peer routing.

// P2PNode is a subset of the hmnet Node that is used by syncing service.
type P2PNode interface {
	Bitswap() *ipfs.Bitswap
	SyncingClient(context.Context, peer.ID) (p2p.SyncingClient, error)
	Client(context.Context, peer.ID) (p2p.P2PClient, error)
	Libp2p() *ipfs.Libp2p
	CheckHyperMediaProtocolVersion(ctx context.Context, pid peer.ID, desiredVersion string, protos ...protocol.ID) (err error)
	ProtocolVersion() string
}

// NewService creates a new syncing service. Users should call Start() to start the periodic syncing.
func NewService(cfg config.Syncing, log *zap.Logger, db *sqlitex.Pool, indexer blockstore.Blockstore, net P2PNode, sstore SubscriptionStore) *Service {
	svc := &Service{
		cfg:        cfg,
		log:        log,
		db:         db,
		indexer:    indexer,
		bitswap:    net.Bitswap(),
		rbsrClient: net.SyncingClient,
		p2pClient:  net.Client,
		host:       net.Libp2p().Host,
		workers:    make(map[peer.ID]*worker),
		semaphore:  make(chan struct{}, peerRoutingConcurrency),
		sstore:     sstore,
	}
	svc.pc = protocolChecker{
		checker: net.CheckHyperMediaProtocolVersion,
		version: net.ProtocolVersion(),
	}

	return svc
}

// SetDocGetter sets the local Doc getter when its ready
func (s *Service) SetDocGetter(docGetter LocalDocGetter) {
	s.docGetter = docGetter
}

// Start the syncing service which will periodically refresh the list of peers
// to sync with from the database, and schedule the worker loop for each peer,
// creating new workers for newly added peers, and stopping workers for removed peers.
func (s *Service) Start(ctx context.Context) (err error) {
	s.log.Debug("SyncingServiceStarted")
	defer func() {
		s.log.Debug("SyncingServiceFinished", zap.Error(err))
	}()

	ctx, cancel := context.WithCancel(ctx)
	defer func() {
		cancel()
		s.wg.Wait()
	}()

	t := time.NewTimer(s.cfg.WarmupDuration)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			if err := s.refreshWorkers(ctx); err != nil {
				return err
			}

			t.Reset(s.cfg.RefreshInterval)
		}
	}
}

var qListPeersWithPid = dqb.Str(`
	SELECT
		addresses,
		pid
	FROM peers;
`)

func (s *Service) refreshWorkers(ctx context.Context) error {
	peers := make(map[peer.ID]struct{}, int(float64(len(s.workers))*1.9)) // arbitrary multiplier to avoid map resizing.
	conn, release, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	if err = sqlitex.Exec(conn, qListPeersWithPid(), func(stmt *sqlite.Stmt) error {
		addresStr := stmt.ColumnText(0)
		pid := stmt.ColumnText(1)
		addrList := strings.Split(addresStr, ",")
		info, err := netutil.AddrInfoFromStrings(addrList...)
		if err != nil {
			s.log.Warn("Can't periodically sync with peer because it has malformed addresses", zap.String("PID", pid), zap.Error(err))
			return nil
		}
		s.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
		peers[info.ID] = struct{}{}
		return nil
	}); err != nil {
		release()
		return err
	}
	release()

	var workersDiff int

	// Starting workers for newly added trusted peers.
	for pid := range peers {
		if _, ok := s.workers[pid]; !ok {
			w := newWorker(s.cfg, pid, s.log, s.rbsrClient, s.host, s.indexer, s.bitswap, s.db, s.semaphore, s.sstore)
			s.wg.Add(1)
			go w.start(ctx, &s.wg, s.cfg.Interval)
			workersDiff++
			s.workers[pid] = w
		}
	}

	// Stop workers for those peers we no longer trust.
	for _, w := range s.workers {
		if _, ok := peers[w.pid]; !ok {
			w.stop()
			workersDiff--
			delete(s.workers, w.pid)
		}
	}

	mWorkers.Add(float64(workersDiff))

	return nil
}

// SyncAllAndLog is the same as Sync but will log the results instead of returning them.
// Calls will be de-duplicated as only one sync loop may be in progress at any given moment.
// Returned error indicates a fatal error. The behavior of calling Sync again after a fatal error is undefined.
func (s *Service) SyncAllAndLog(ctx context.Context) error {
	log := s.log.With(zap.Int64("traceID", time.Now().UnixMicro()))

	log.Info("SyncLoopStarted")
	var err error
	var res SyncResult

	res, err = s.SyncAll(ctx)

	if err != nil {
		if errors.Is(err, ErrSyncAlreadyRunning) {
			log.Debug("SyncLoopIsAlreadyRunning")
			return nil
		}
		return fmt.Errorf("fatal error in the sync background loop: %w", err)
	}

	for i, err := range res.Errs {
		if err != nil {
			log.Debug("SyncLoopError",
				zap.String("peer", res.Peers[i].String()),
				zap.Error(err),
			)
		}
	}

	log.Info("SyncLoopFinished",
		zap.Int64("failures", res.NumSyncFailed),
		zap.Int64("successes", res.NumSyncOK),
	)

	return nil
}

// ErrSyncAlreadyRunning is returned when calling Sync while one is already in progress.
var ErrSyncAlreadyRunning = errors.New("sync is already running")

// SyncResult is a summary of one Sync loop iteration.
type SyncResult struct {
	NumSyncOK     int64
	NumSyncFailed int64
	Peers         []peer.ID
	Errs          []error
}

// SyncAll attempts to sync the with all the peers at once.
func (s *Service) SyncAll(ctx context.Context) (res SyncResult, err error) {
	return s.SyncSubscribedContent(ctx)
}

// SyncSubscribedContent attempts to sync all the content marked as subscribed.
// However, if subscriptions are passed to this function, only those docs will
// be synced.
func (s *Service) SyncSubscribedContent(ctx context.Context, subscriptions ...*activity_proto.Subscription) (res SyncResult, err error) {
	for !s.mu.TryLock() {
		select {
		case <-ctx.Done():
			return res, ctx.Err()
		case <-time.After(time.Second * 1):
		}
		time.Sleep(time.Second)
	}
	defer s.mu.Unlock()
	conn, release, err := s.db.Conn(ctx)
	if err != nil {
		s.log.Debug("Could not grab a connection", zap.Error(err))
		return res, err
	}

	s.log.Debug("Got db connections")
	if len(subscriptions) == 0 {
		s.log.Debug("No subscriptions passed, grabbing all of them")
		ret, err := s.sstore.ListSubscriptions(ctx, &activity_proto.ListSubscriptionsRequest{
			PageSize: math.MaxInt32,
		})
		s.log.Debug("List all subscriptions", zap.Error(err))
		if err != nil {
			release()
			return res, err
		}
		subscriptions = ret.Subscriptions
	}
	s.log.Debug("SyncSubscribedContent called", zap.Int("Number of total subscriptions", len(subscriptions)))
	if len(subscriptions) == 0 {
		release()
		return res, nil
	}
	subsMap := make(subscriptionMap)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	if err = sqlitex.Exec(conn, qListPeersWithPid(), func(stmt *sqlite.Stmt) error {
		addresStr := stmt.ColumnText(0)
		pid := stmt.ColumnText(1)
		addrList := strings.Split(addresStr, ",")
		info, err := netutil.AddrInfoFromStrings(addrList...)
		if err != nil {
			s.log.Warn("Can't sync subscribed content with peer with malformed addresses", zap.String("PID", pid), zap.Error(err))
			return nil
		}
		s.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
		allPeers = append(allPeers, info.ID)
		return nil
	}); err != nil {
		release()
		return res, err
	}
	release()
	s.log.Debug("Got list of peers", zap.Int("Number of total peers", len(allPeers)))
	eidsMap := make(map[string]bool)
	for _, subs := range subscriptions {
		eid := "hm://" + subs.Account + subs.Path
		eidsMap[eid] = subs.Recursive
	}
	if len(allPeers) == 0 {
		s.log.Debug("Defaulting to DHT since we don't have providers")
		for _, subs := range subscriptions {
			c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte("hm://"+subs.Account+subs.Path))
			if err != nil {
				continue
			}
			peers := s.bitswap.FindProvidersAsync(ctx, c, 3)
			s.log.Debug("DHT returned", zap.Int("Number of providers found", len(peers)))
			for p := range peers {
				p := p
				allPeers = append(allPeers, p.ID)
			}
		}
	}

	if len(allPeers) == 0 {
		return res, fmt.Errorf("Could not find any provider for any of the subscribed content")
	}
	s.log.Debug("Syncing Subscribed content", zap.Int("Number of documents", len(eidsMap)), zap.Int("Number of peers", len(allPeers)))
	for _, pid := range allPeers {
		// TODO(juligasa): look into the providers store who has each eid
		// instead of pasting all peers in all documents.
		subsMap[pid] = eidsMap
	}

	return s.syncWithManyPeers(ctx, subsMap), nil
}

// syncWithManyPeers syncs with many peers in parallel
func (s *Service) syncWithManyPeers(ctx context.Context, subsMap subscriptionMap) (res SyncResult) {
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
				} else {
					atomic.AddInt64(&res.NumSyncFailed, 1)
				}

				wg.Done()
			}()

			res.Peers[i] = pid
			s.log.Debug("Syncing with peer", zap.String("PID", pid.String()))
			if xerr := s.syncWithPeer(ctx, pid, eids); xerr != nil {
				s.log.Debug("Could not sync with content", zap.String("PID", pid.String()), zap.Error(xerr))
				err = errors.Join(err, fmt.Errorf("failed to sync objects: %w", xerr))
			}
		}(i, pid, eids)
		i++
	}

	wg.Wait()

	return res
}

// syncWithPeer syncs all documents from a given peer. given no initial objectsOptionally.
// If a non empty entity is provided, then only syncs blobs related to that entities.
func (s *Service) syncWithPeer(ctx context.Context, pid peer.ID, eids map[string]bool) error {
	// Can't sync with self.
	if s.host.Network().LocalPeer() == pid {
		s.log.Debug("Sync with self attempted")
		return fmt.Errorf("Can't sync with self")
	}

	{
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.TimeoutPerPeer)
		defer cancel()
	}
	s.log.Debug("SyncWithPeer called")
	c, err := s.rbsrClient(ctx, pid)
	if err != nil {
		s.log.Debug("Could not get syncing client", zap.Error(err))
		return err
	}

	bswap := s.bitswap.NewSession(ctx)

	return syncEntities(ctx, pid, c, s.indexer, bswap, s.db, s.log, eids)
}

func syncEntities(
	ctx context.Context,
	pid peer.ID,
	c p2p.SyncingClient,
	idx blockstore.Blockstore,
	sess exchange.Fetcher,
	db *sqlitex.Pool,
	log *zap.Logger,
	eids map[string]bool,
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

	store := rbsr.NewSliceStore()

	dkeys := make(map[discoveryKey]struct{}, len(eids))

	for eid, recursive := range eids {
		eid = strings.TrimSuffix(eid, "/")
		dkey := discoveryKey{
			IRI:       blob.IRI(eid),
			Recursive: recursive,
		}
		dkeys[dkey] = struct{}{}
	}

	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return err
	}

	if err := store.Seal(); err != nil {
		return err
	}

	localHaves := make(map[cid.Cid]struct{}, store.Size())

	if err := store.ForEach(0, store.Size(), func(i int, it rbsr.Item) bool {
		localCid, err := cid.Cast(it.Value)
		if err != nil {
			panic(err)
		}
		localHaves[localCid] = struct{}{}
		return true
	}); err != nil {
		return err
	}

	ne, err := rbsr.NewSession(store, 50000)
	if err != nil {
		return fmt.Errorf("failed to Init Syncing Session: %w", err)
	}

	msg, err := ne.Initiate()
	if err != nil {
		return err
	}

	var (
		allWants []cid.Cid
		rounds   int

		// We'll be reusing the slices for haves and wants on each round trip to reduce allocations.
		haves [][]byte
		wants [][]byte
	)

	filters := make([]*p2p.Filter, 0, len(eids))
	for eid, recursive := range eids {
		filters = append(filters, &p2p.Filter{Resource: eid, Recursive: recursive})
	}

	for msg != nil {
		rounds++
		if rounds > 1000 {
			return fmt.Errorf("Too many rounds of interactive syncing")
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
			if _, ok := localHaves[blockCid]; !ok {
				allWants = append(allWants, blockCid)
			}
		}
		log.Debug("Blobs Reconciled", zap.Int("round", rounds), zap.Int("wants", len(allWants)))
	}

	if len(allWants) == 0 {
		log.Debug("Peer does not have new content")
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(len(allWants)))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(len(allWants)))

	downloadedBlocks := list.New()
	for _, blkID := range allWants {
		log.Debug("Fetching new block", zap.String("cid", blkID.String()))
		blk, err := sess.GetBlock(ctx, blkID)
		if err != nil {
			log.Debug("FailedToGetWantedBlob", zap.String("cid", blkID.String()), zap.Error(err))
			continue
		}
		downloadedBlocks.PushBack(blk)
	}
	var failed int
	for downloadedBlocks.Len() > 0 {
		item := downloadedBlocks.Front()
		if failed == downloadedBlocks.Len() {
			return fmt.Errorf("could not sync all content due to indexing (dependencies) problems")
		}
		blk, ok := item.Value.(blocks.Block)
		if !ok {
			return fmt.Errorf("could not decode block from the list: %w", err)
		}

		if err := idx.Put(ctx, blk); err != nil {
			log.Debug("FailedToSaveWantedBlob", zap.String("cid", blk.Cid().String()), zap.Error(err))
			downloadedBlocks.MoveAfter(item, downloadedBlocks.Back())
			failed++
			continue
		}
		log.Debug("Blob synced and stored", zap.String("blobCid", blk.Cid().String()))
		failed = 0
		downloadedBlocks.Remove(item)
	}
	log.Debug("Successfully synced new content")
	return nil
}

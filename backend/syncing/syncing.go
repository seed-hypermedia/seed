package syncing

import (
	"context"
	"errors"
	"fmt"
	"math"
	activity "seed/backend/api/activity/v1alpha"
	"seed/backend/config"
	"seed/backend/core"
	activity_proto "seed/backend/genproto/activity/v1alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/ipfs"
	"seed/backend/mttnet"
	"seed/backend/syncing/rbsr"
	"seed/backend/util/dqb"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"seed/backend/index"

	"container/list"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/boxo/exchange"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/event"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
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
	GetSubsEventCh() chan interface{}
	GetSubsSyncEventCh() chan interface{}
}
type protocolChecker struct {
	checker func(context.Context, peer.ID, string) error
	version string
}
type Service struct {
	cfg        config.Syncing
	log        *zap.Logger
	db         *sqlitex.Pool
	indexer    *index.Index
	bitswap    bitswap
	rbsrClient netDialFunc
	p2pClient  func(context.Context, peer.ID) (p2p.P2PClient, error)
	host       host.Host
	pc         protocolChecker
	mu         sync.Mutex // Ensures only one sync loop is running at a time.
	sstore     SubscriptionStore
	wg         sync.WaitGroup
	workers    map[peer.ID]*worker
	semaphore  chan struct{}
}

const (
	connectTimeout = 30 * time.Second
)

const peerRoutingConcurrency = 3 // how many concurrent requests for peer routing.

// NewService creates a new syncing service. Users should call Start() to start the periodic syncing.
func NewService(cfg config.Syncing, log *zap.Logger, db *sqlitex.Pool, indexer *index.Index, net *mttnet.Node, sstore SubscriptionStore) *Service {
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
		version: net.GetProtocolVersion(),
	}
	if !cfg.NoSyncBack {
		net.SetIdentificationCallback(svc.syncBack)
	}

	go func() {
		for e := range sstore.GetSubsEventCh() {
			switch event := e.(type) {
			case activity.SubscribedEvnt:
				log.Debug("SubscribedEvnt received", zap.String("Account", event.Account), zap.String("Path", event.Path), zap.Bool("Recursive", event.Recursive))
				res, err := svc.SyncSubscribedContent(context.Background(), &activity_proto.Subscription{
					Account:   event.Account,
					Path:      event.Path,
					Recursive: event.Recursive,
				})
				log.Debug("SyncSubscribedContent Finished", zap.Errors("Errors in return", res.Errs), zap.Error(err))
				evnt := activity.SubscribedSyncEvnt{
					SubID: event.ID}
				if err != nil {
					evnt.Err = err
				} else if res.NumSyncOK == 0 {
					evnt.Err = fmt.Errorf("We could not sync the subscribed content with any provider")
				} else {
					log.Debug("Successfully synced content", zap.Int64("NumSyncOK", res.NumSyncOK))
				}
				sstore.GetSubsSyncEventCh() <- evnt
			}
		}
	}()

	return svc
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

var qListPeers = dqb.Str(`
	SELECT 
		pid
	FROM peers;
`)

func (s *Service) refreshWorkers(ctx context.Context) error {
	peers := make(map[peer.ID]struct{}, int(float64(len(s.workers))*1.5)) // arbitrary multiplier to avoid map resizing.
	conn, release, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	if err = sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
		pidStr := stmt.ColumnText(0)
		pid, err := peer.Decode(pidStr)
		if err != nil {
			return err
		}
		peers[pid] = struct{}{}
		return nil
	}); err != nil {
		return err
	}

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
	if s.cfg.SmartSyncing {
		return s.SyncSubscribedContent(ctx)
	}
	if !s.mu.TryLock() {
		return res, ErrSyncAlreadyRunning
	}
	defer s.mu.Unlock()

	seedPeers := []peer.ID{}

	conn, release, err := s.db.Conn(ctx)
	if err != nil {
		return res, err
	}
	defer release()
	if err = sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
		pidStr := stmt.ColumnText(0)
		pid, err := peer.Decode(pidStr)
		if err != nil {
			return err
		}
		seedPeers = append(seedPeers, pid)
		return nil
	}); err != nil {
		return res, err
	}
	res.Peers = make([]peer.ID, len(seedPeers))
	res.Errs = make([]error, len(seedPeers))
	var wg sync.WaitGroup
	wg.Add(len(seedPeers))

	for i, pid := range seedPeers {
		go func(i int, pid peer.ID) {
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

			if xerr := s.SyncWithPeer(ctx, pid, nil); xerr != nil {
				err = errors.Join(err, fmt.Errorf("failed to sync objects: %w", xerr))
			}
		}(i, pid)
	}

	wg.Wait()

	return res, nil
}

// SyncSubscribedContent attempts to sync all the content marked as subscribed.
// However, if subscriptions are passed to this function, only those docs will
// be synced.
func (s *Service) SyncSubscribedContent(ctx context.Context, subscriptions ...*activity_proto.Subscription) (res SyncResult, err error) {
	if !s.mu.TryLock() {
		return res, ErrSyncAlreadyRunning
	}
	defer s.mu.Unlock()
	s.log.Debug("SyncSubscribedContent called", zap.Int("Number of subscriptions", len(subscriptions)))
	dbCtx, ctxCncl := context.WithTimeout(ctx, time.Second*5)
	defer ctxCncl()
	conn, release, err := s.db.Conn(dbCtx)
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
	s.log.Debug("New Subscriptions gotten", zap.Int("Number of total subscriptions", len(subscriptions)))
	if len(subscriptions) == 0 {
		release()
		return res, nil
	}
	subsMap := make(map[peer.ID]map[string]bool)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	if err = sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
		pidStr := stmt.ColumnText(0)
		pid, err := peer.Decode(pidStr)
		if err != nil {
			return err
		}
		allPeers = append(allPeers, pid)
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
				s.host.Peerstore().AddAddrs(p.ID, p.Addrs, time.Minute*10)
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
	res.Peers = make([]peer.ID, len(allPeers))
	res.Errs = make([]error, len(allPeers))
	var i int
	var wg sync.WaitGroup
	wg.Add(len(subsMap))
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
			s.log.Debug("Syncing with peer to get subscribed content", zap.String("PID", pid.String()))
			if xerr := s.SyncWithPeer(ctx, pid, eids); xerr != nil {
				err = errors.Join(err, fmt.Errorf("failed to sync objects: %w", xerr))
			}
		}(i, pid, eids)
		i++
	}

	wg.Wait()

	return res, nil
}

// SyncWithPeer syncs all documents from a given peer. given no initial objectsOptionally.
// If a non empty entity is provided, then only syncs blobs related to that entities.
func (s *Service) SyncWithPeer(ctx context.Context, pid peer.ID, eids map[string]bool) error {
	// Can't sync with self.
	if s.host.Network().LocalPeer() == pid {
		s.log.Debug("Sync with self attempted")
		return nil
	}

	{
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, connectTimeout)
		defer cancel()
	}

	c, err := s.rbsrClient(ctx, pid)
	if err != nil {
		return err
	}

	{
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.TimeoutPerPeer)
		defer cancel()
	}

	bswap := s.bitswap.NewSession(ctx)

	if len(eids) != 0 {
		s.log.Debug("Sync with entities", zap.Int("num entities", len(eids)), zap.String("Peer", pid.String()))
		return syncEntities(ctx, pid, c, s.indexer, bswap, s.db, s.log, eids)
	}
	s.log.Debug("Sync Everything", zap.String("Peer", pid.String()))
	return syncPeerRbsr(ctx, pid, c, s.indexer, bswap, s.db, s.log)
}

func (s *Service) syncBack(ctx context.Context, event event.EvtPeerIdentificationCompleted) {
	if s.host.Network().Connectedness(event.Peer) != network.Connected {
		return
	}

	if err := s.pc.checker(ctx, event.Peer, s.pc.version); err != nil {
		return
	}

	c, err := s.p2pClient(ctx, event.Peer)
	if err != nil {
		s.log.Warn("Could not get p2p client", zap.Error(err))
		return
	}
	res, err := c.ListPeers(ctx, &p2p.ListPeersRequest{PageSize: math.MaxInt32})
	if err != nil {
		s.log.Warn("Could not get list of peers", zap.Error(err))
		return
	}
	conn, cancel, err := s.db.Conn(ctx)
	if err != nil {
		s.log.Error("Could not get connection")
	}
	defer cancel()
	if len(res.Peers) > 0 {
		vals := []interface{}{}
		sqlStr := "INSERT OR REPLACE INTO peers (pid, addresses) VALUES "
		for _, peer := range res.Peers {
			if len(peer.Addrs) > 0 {
				sqlStr += "(?, ?),"
				vals = append(vals, peer.Id, strings.Join(peer.Addrs, ","))
			}

		}
		sqlStr = sqlStr[0 : len(sqlStr)-1]

		if err := sqlitex.Exec(conn, sqlStr, nil, vals...); err != nil {
			s.log.Warn("Could not insert the remote list of peers: %w", zap.Error(err))
			return
		}
	}

	info := s.host.Peerstore().PeerInfo(event.Peer)

	if info.ID == s.host.Network().LocalPeer() {
		return
	}
	if len(info.Addrs) == 0 {
		return
	}
	addrsStr := mttnet.AddrInfoToStrings(info)

	const q = "SELECT addresses FROM peers WHERE pid = ?;"
	var addresses string
	if err := sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
			addresses = stmt.ColumnText(0)
			return nil
		}, info.ID.String()); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return
	}
	var foundInfo peer.AddrInfo
	foundAddressesStr := strings.Split(strings.Trim(addresses, " "), ",")
	if len(foundAddressesStr) != 0 && len(foundAddressesStr[0]) != 0 {
		foundInfo, err = mttnet.AddrInfoFromStrings(foundAddressesStr...)
		if err != nil {
			return
		}
	}
	if foundInfo.String() != info.String() {
		if err := sqlitex.Exec(conn, "INSERT OR REPLACE INTO peers (pid, addresses) VALUES (?, ?);", nil, info.ID.String(), strings.Join(addrsStr, ",")); err != nil {
			s.log.Warn("Could not store peer", zap.Error(err))
		} else {
			s.log.Info("Syncing back", zap.String("PeerID", info.ID.String()))
			go s.SyncWithPeer(ctx, info.ID, nil)
		}
	}

}

func syncEntities(
	ctx context.Context,
	pid peer.ID,
	c p2p.SyncingClient,
	idx *index.Index,
	sess exchange.Fetcher,
	db *sqlitex.Pool,
	log *zap.Logger,
	eids map[string]bool,
) (err error) {
	mSyncsInFlight.Inc()
	defer func() {
		mSyncsInFlight.Dec()
		mSyncsTotal.Inc()
		if err != nil {
			mSyncErrorsTotal.Inc()
		}
	}()

	if _, ok := ctx.Deadline(); !ok {
		return fmt.Errorf("BUG: syncEntity must have timeout")
	}

	// If we know what we want, it's a 1 way syncing so we don't share anything
	store := rbsr.NewSliceStore()
	ne, err := rbsr.NewSession(store, 50000)

	if err != nil {
		return fmt.Errorf("Failed to Init Syncing Session: %w", err)
	}
	if err = store.Seal(); err != nil {
		return fmt.Errorf("Failed to seal store: %w", err)
	}
	msg, err := ne.Initiate()
	if err != nil {
		return err
	}

	allWants := list.New()

	var rounds int
	for msg != nil {
		rounds++
		if rounds > 1000 {
			return fmt.Errorf("Too many rounds of interactive syncing")
		}
		filters := []*p2p.Filter{}
		for eid, recursive := range eids {
			filters = append(filters, &p2p.Filter{Resource: eid, Recursive: recursive})
		}
		res, err := c.ReconcileBlobs(ctx, &p2p.ReconcileBlobsRequest{
			Ranges:  msg,
			Filters: filters,
		})
		if err != nil {
			return err
		}
		msg = res.Ranges
		var haves, wants [][]byte
		msg, err = ne.ReconcileWithIDs(msg, &haves, &wants)
		if err != nil {
			return err
		}
		for _, want := range wants {
			allWants.PushBack(want)
		}
		log.Debug("Blobs Reconciled", zap.Int("Wants", allWants.Len()))
	}

	if allWants.Len() == 0 {
		log.Debug("Peer does not have new content")
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(allWants.Len()))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(allWants.Len()))

	log = log.With(
		zap.String("peer", pid.String()),
	)

	var failed int
	for allWants.Len() > 0 {
		item := allWants.Front()
		if failed == allWants.Len() {
			return fmt.Errorf("could not sync all content")
		}
		blobCid, err := cid.Cast(item.Value.([]byte))
		if err != nil {
			return err
		}
		blk, err := sess.GetBlock(ctx, blobCid)
		if err != nil {
			log.Debug("FailedToGetWantedBlob", zap.String("cid", blobCid.String()), zap.Error(err))
			allWants.MoveAfter(item, allWants.Back())
			failed++
			continue
		}

		if err := idx.Put(ctx, blk); err != nil {
			log.Debug("FailedToSaveWantedBlob", zap.String("cid", blobCid.String()), zap.Error(err))
			allWants.MoveAfter(item, allWants.Back())
			failed++
			continue
		}
		failed = 0
		log.Debug("Blob synced", zap.String("blobCid", blobCid.String()))
		allWants.Remove(item)
	}

	return nil
}

func syncPeerRbsr(
	ctx context.Context,
	pid peer.ID,
	c p2p.SyncingClient,
	idx *index.Index,
	sess exchange.Fetcher,
	db *sqlitex.Pool,
	log *zap.Logger,
) (err error) {
	mSyncsInFlight.Inc()
	defer func() {
		mSyncsInFlight.Dec()
		mSyncsTotal.Inc()
		if err != nil {
			mSyncErrorsTotal.Inc()
		}
	}()

	if _, ok := ctx.Deadline(); !ok {
		return fmt.Errorf("BUG: syncPeerRbsr must have timeout")
	}

	store := rbsr.NewSliceStore()
	ne, err := rbsr.NewSession(store, 50000)

	if err != nil {
		return fmt.Errorf("Failed to Init Syncing Session: %w", err)
	}

	var qListBlobs = dqb.Str(`
		SELECT
			blobs.codec,
			blobs.multihash,
			blobs.insert_time
		FROM blobs INDEXED BY blobs_metadata LEFT JOIN structural_blobs sb ON sb.id = blobs.id
		WHERE blobs.size >= 0 
		ORDER BY sb.ts, blobs.multihash;
	`)
	conn, release, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("Could not get connection: %w", err)
	}
	defer release()

	if err = sqlitex.Exec(conn, qListBlobs(), func(stmt *sqlite.Stmt) error {
		codec := stmt.ColumnInt64(0)
		hash := stmt.ColumnBytesUnsafe(1)
		ts := stmt.ColumnInt64(2)
		rawCid := cid.NewCidV1(uint64(codec), hash)
		return store.Insert(ts, rawCid.Bytes())
	}); err != nil {
		return fmt.Errorf("Could not list blobs: %w", err)
	}
	if err = store.Seal(); err != nil {
		return fmt.Errorf("Failed to seal store: %w", err)
	}

	msg, err := ne.Initiate()
	if err != nil {
		return err
	}

	allWants := list.New()

	var rounds int
	for msg != nil {
		rounds++
		if rounds > 1000 {
			return fmt.Errorf("Too many rounds of interactive syncing")
		}
		res, err := c.ReconcileBlobs(ctx, &p2p.ReconcileBlobsRequest{Ranges: msg})
		if err != nil {
			return err
		}
		msg = res.Ranges
		var haves, wants [][]byte
		msg, err = ne.ReconcileWithIDs(msg, &haves, &wants)
		if err != nil {
			return err
		}
		for _, want := range wants {
			allWants.PushBack(want)
		}
	}

	if allWants.Len() == 0 {
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(allWants.Len()))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(allWants.Len()))

	log = log.With(
		zap.String("peer", pid.String()),
	)
	var failed int
	for allWants.Len() > 0 {
		item := allWants.Front()
		if failed == allWants.Len() {
			return fmt.Errorf("could not sync all content")
		}
		blockCid, err := cid.Cast(item.Value.([]byte))
		if err != nil {
			return err
		}
		blk, err := sess.GetBlock(ctx, blockCid)
		if err != nil {
			log.Debug("FailedToGetWantedBlob", zap.String("cid", blockCid.String()), zap.Error(err))
			allWants.MoveAfter(item, allWants.Back())
			failed++
			continue
		}

		if err := idx.Put(ctx, blk); err != nil {
			log.Debug("FailedToSaveWantedBlob", zap.String("cid", blockCid.String()), zap.Error(err))
			allWants.MoveAfter(item, allWants.Back())
			failed++
			continue
		}
		failed = 0
		allWants.Remove(item)
	}

	return nil
}

// GetCursor from the last sync with the given peer.
func GetCursor[T *sqlite.Conn | *sqlitex.Pool](ctx context.Context, db T, peer core.Principal) (cursor string, err error) {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return "", err
		}
		defer release()
		conn = c
	}

	err = sqlitex.Exec(conn, qGetCursor(), func(stmt *sqlite.Stmt) error {
		cursor = stmt.ColumnText(0)
		return nil
	}, peer)
	return cursor, err
}

var qGetCursor = dqb.Str(`
	SELECT cursor
	FROM syncing_cursors
	WHERE peer = (
		SELECT id
		FROM public_keys
		WHERE principal = ?
	)
	LIMIT 1;
`)

// SaveCursor for the given peer.
func SaveCursor[T *sqlite.Conn | *sqlitex.Pool](ctx context.Context, db T, peer core.Principal, cursor string) error {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return err
		}
		defer release()
		conn = c
	}

	return sqlitex.Exec(conn, qSaveCursor(), nil, peer, cursor)
}

var qSaveCursor = dqb.Str(`
	INSERT OR REPLACE INTO syncing_cursors (peer, cursor)
	VALUES (
		(SELECT id FROM public_keys WHERE principal = :peer),
		:cursor
	);
`)

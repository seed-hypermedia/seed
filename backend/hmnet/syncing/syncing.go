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
	"strings"
	"sync/atomic"
	"time"

	"seed/backend/util/longrunning"
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
	"golang.org/x/sync/errgroup"
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

	// Diagnostic histograms. Buckets span 1 ms → ~6 min with 50 exponential
	// bins to give useful p50/p95/p99 across the full dynamic range we see
	// in practice.
	diagBuckets = prometheus.ExponentialBuckets(0.001, 1.30, 50)

	// MDiscoverTotalSeconds is end-to-end DiscoverObject wall-clock, labeled by outcome.
	MDiscoverTotalSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_discover_total_seconds",
		Help:    "End-to-end DiscoverObject wall-clock, bucketed by outcome (connected|dht|notfound|error).",
		Buckets: diagBuckets,
	}, []string{"outcome"})

	// MDiscoverPhaseSeconds is per-phase wall-clock of DiscoverObject.
	MDiscoverPhaseSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_discover_phase_seconds",
		Help:    "Per-phase wall-clock of DiscoverObject (peer_select|connected_sync|dht_discover|dht_sync).",
		Buckets: diagBuckets,
	}, []string{"phase"})

	// MSyncPeerPhaseSeconds is per-phase wall-clock of syncWithPeer.
	MSyncPeerPhaseSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_phase_seconds",
		Help:    "Per-phase wall-clock of syncWithPeer (dial|reconcile_rpc|bitswap_fetch|putmany).",
		Buckets: diagBuckets,
	}, []string{"phase"})

	// MSyncOutcomeTotal counts per-sync-attempt categorized results.
	MSyncOutcomeTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_sync_outcome_total",
		Help: "Per-sync-attempt categorized result (ok|protocol_mismatch|dial_failed|rpc_error|preempted|putmany_failed).",
	}, []string{"outcome"})

	// MSyncBitswapOutcome counts how each bitswap fetch loop terminated:
	//   complete     - blocks channel closed and ctx was still alive (session ended naturally)
	//   idle_timeout - the 40s idle timer fired without a new block arriving
	//   ctx_done     - context canceled/expired while the loop was running
	// Distinguishes "we gave up" vs. "we finished slowly" in the bitswap tail.
	MSyncBitswapOutcome = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_syncpeer_bitswap_outcome_total",
		Help: "How each bitswap fetch terminated (complete|idle_timeout|ctx_done).",
	}, []string{"outcome"})

	// MSyncBitswapCompleteness is downloaded/wanted per bitswap fetch. A value
	// of 1.0 means every requested blob arrived; low ratios on idle_timeout
	// calls indicate we're asking peers for blobs they don't actually have.
	MSyncBitswapCompleteness = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_bitswap_completeness_ratio",
		Help:    "Ratio of downloaded/wanted blobs per bitswap fetch, in [0,1].",
		Buckets: []float64{0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0},
	})

	// MSyncBitswapLastBlockAge is, per fetch, the wall-clock gap between the
	// most recent received block and the moment the download loop exited.
	// Interpretation by outcome:
	//   complete     - gap near 0 means channel closed right after the last
	//                  block (productive exit). Larger values mean bitswap
	//                  kept the channel open past the last useful arrival.
	//   idle_timeout - tautologically equals the idle-timer value; not
	//                  interesting on its own but included for consistency.
	//   ctx_done     - tells us how much time we had already spent idle
	//                  when cancellation landed.
	// Use this to decide whether shortening the idle timer would clip
	// legitimate late arrivals (spread across the 0-to-idleTimeout window)
	// or would only cut dead wait (cluster at idleTimeout).
	MSyncBitswapLastBlockAge = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_bitswap_last_block_age_seconds",
		Help:    "Seconds between the last received block and the download loop exit, per outcome.",
		Buckets: diagBuckets,
	}, []string{"outcome"})

	// MSyncBitswapFetchSeconds is per-call wall-clock of the download loop,
	// labeled by outcome. Separates "happy path" latency from "idle timeout"
	// or "ctx cancellation" tails — MSyncPeerPhaseSeconds{phase="bitswap_fetch"}
	// aggregates them together.
	MSyncBitswapFetchSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_bitswap_seconds",
		Help:    "Wall-clock of each bitswap fetch, per outcome.",
		Buckets: diagBuckets,
	}, []string{"outcome"})

	// MSyncDiscardedBlobs counts blocks that bitswap successfully delivered
	// but were thrown away because the per-peer sync ctx was already cancelled
	// by the time we reached the persist phase. Each one was paid for on the
	// wire and will be re-fetched on the next sync cycle. Surfaced on
	// /debug/network so the magnitude of "wasted bandwidth from late
	// cancellation" is visible.
	MSyncDiscardedBlobs = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncpeer_discarded_blobs_total",
		Help: "Blocks downloaded by bitswap then discarded because sync ctx was cancelled before persist.",
	})

	// MSyncDiscardedEvents counts how many sync attempts ended in this
	// "downloaded then discarded" state. Lets us tell "many discards over a
	// few events" (one big sync got cut short) from "many events" (chronic
	// cancellation pattern).
	MSyncDiscardedEvents = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncpeer_discarded_events_total",
		Help: "Sync attempts that downloaded blocks then discarded them due to ctx cancellation.",
	})

	// MSyncWantedBlobsPerPeer is the size of the bitswap wantlist RBSR
	// produces per peer-sync. A healthy distribution clusters near zero with
	// a long tail of small numbers — the diff is small because we already
	// have most of what the peer has. Persistent high values mean RBSR's
	// local-set query is undercounting what we actually have on disk, so
	// every sync re-fetches the same blobs.
	MSyncWantedBlobsPerPeer = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_wanted_blobs",
		Help:    "Number of blobs RBSR identified as missing from us per peer-sync.",
		Buckets: []float64{1, 10, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000},
	})

	// MSyncPersistRollbackTotal counts streaming-persist batches that failed
	// PutMany — most often because indexBlob hit a cross-blob reference whose
	// referent hadn't arrived yet (e.g. a Change ahead of its genesis_blob).
	// Those blobs come back next sync cycle and converge once order doesn't
	// matter; a small steady value here is expected during big initial syncs,
	// while a sustained high value points at a real ordering / dependency bug.
	MSyncPersistRollbackTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncpeer_persist_rollback_total",
		Help: "Streaming-persist PutMany batch failures (likely ordering dependency).",
	})

	// MSyncPersistRollbackBlocks counts the number of individual blocks lost
	// to PutMany batch rollbacks. Useful alongside MSyncPersistRollbackTotal
	// to size the cost: 1 rollback × 10-blob batch = 10 lost blocks.
	MSyncPersistRollbackBlocks = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncpeer_persist_rollback_blocks_total",
		Help: "Blocks lost to PutMany batch rollbacks during streaming persist.",
	})

	// MSyncPreflightSkipped counts CIDs that RBSR put on the wantlist but our
	// blockstore already has by multihash. RBSR identifies items by full CID
	// (codec + multihash); the blockstore is keyed by multihash alone, so the
	// same content tagged under a different codec on a peer (raw=85 vs
	// dag-pb=112 is the typical case) shows up as "they have, we don't" in
	// the diff and gets fetched, only to be dropped at putBlock with the
	// `exists` outcome. Filtering before bitswap saves the WANT_HAVE → HAVE →
	// WANT_BLOCK → BLOCK round-trip and the block delivery itself. Should
	// closely shadow the rate at which mPutBlockOutcome{outcome="exists"}
	// would have grown without the filter — a non-zero value here is direct
	// inbound bandwidth saved.
	MSyncPreflightSkipped = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_syncpeer_preflight_skipped_total",
		Help: "Wantlist CIDs skipped because the blockstore already has the multihash.",
	})

	// MSyncPreflightWantsPerPeer is the post-filter wantlist size per
	// peer-sync. Compare against MSyncWantedBlobsPerPeer (pre-filter) to see
	// how much of the diff RBSR produced was wasted re-fetch and how much
	// was real new content.
	MSyncPreflightWantsPerPeer = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_syncpeer_preflight_wants",
		Help:    "Number of blobs we'll actually bitswap-fetch per peer-sync, after the local-Has pre-flight filter.",
		Buckets: []float64{1, 10, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000},
	})


	// Server-side ReconcileBlobs handler sub-phase timing. Our daemon serves
	// reconcile requests from other peers; gateways run the same code so this
	// is a structural proxy for what they spend per-request when we're the
	// client paying the 19s p99 tail.
	MReconcileServerPhaseSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_reconcile_server_phase_seconds",
		Help:    "Per sub-phase wall-clock of Server.ReconcileBlobs (auth_resolve|load_store|rbsr_session|rbsr_reconcile).",
		Buckets: diagBuckets,
	}, []string{"phase"})

	// MReconcileServerTotalSeconds is the whole handler wall-clock — directly
	// comparable to client-side reconcile_rpc to spot client-side stream/dial
	// latency that the server can't account for.
	MReconcileServerTotalSeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_reconcile_server_total_seconds",
		Help:    "Wall-clock of the full Server.ReconcileBlobs handler.",
		Buckets: diagBuckets,
	})

	// MReconcileServerStoreSize is store.Size() per request — tells us if the
	// scale factor on rbsr_reconcile is the corpus the filter pulls in.
	MReconcileServerStoreSize = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_reconcile_server_store_size",
		Help:    "Number of blobs in the RBSR store built per ReconcileBlobs request.",
		Buckets: prometheus.ExponentialBuckets(1, 4, 12), // 1, 4, 16, ..., ~4M
	})

	// MReconcileServerFilterSize is the caller-driven input size — useful for
	// normalizing store size to filter breadth ("recursive on a busy account
	// pulls a big store").
	MReconcileServerFilterSize = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_reconcile_server_filter_size",
		Help:    "Number of filters in each ReconcileBlobs request.",
		Buckets: []float64{1, 2, 4, 8, 16, 32, 64, 128, 256},
	})

	// MReconcileServerLimiterLimit is the configured concurrent inbound
	// ReconcileBlobs cap. -1 means unlimited.
	MReconcileServerLimiterLimit = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_reconcile_server_limiter_limit",
		Help: "Configured concurrent inbound ReconcileBlobs cap. -1 means unlimited.",
	})

	// MReconcileServerLimiterInFlight is the number of inbound ReconcileBlobs
	// RPCs currently running inside the expensive handler.
	MReconcileServerLimiterInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_reconcile_server_limiter_in_flight",
		Help: "Number of inbound ReconcileBlobs RPCs currently running inside the expensive handler.",
	})

	// MReconcileServerLimiterWaiting is the number of inbound ReconcileBlobs
	// RPCs currently waiting for capacity.
	MReconcileServerLimiterWaiting = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_reconcile_server_limiter_waiting",
		Help: "Number of inbound ReconcileBlobs RPCs currently waiting for capacity.",
	})

	// MReconcileServerLimiterWaitSeconds is the time an inbound ReconcileBlobs
	// RPC waited for capacity before running or being rejected.
	MReconcileServerLimiterWaitSeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_reconcile_server_limiter_wait_seconds",
		Help:    "Seconds inbound ReconcileBlobs RPCs waited for capacity before running or being rejected.",
		Buckets: diagBuckets,
	})

	// MReconcileServerLimiterAcceptedTotal counts inbound ReconcileBlobs RPCs
	// that acquired capacity and were allowed to run.
	MReconcileServerLimiterAcceptedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_reconcile_server_limiter_accepted_total",
		Help: "Total inbound ReconcileBlobs RPCs that acquired capacity and were allowed to run.",
	})

	// MReconcileServerLimiterRejectedTotal counts inbound ReconcileBlobs RPCs
	// rejected after waiting for capacity.
	MReconcileServerLimiterRejectedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_reconcile_server_limiter_rejected_total",
		Help: "Total inbound ReconcileBlobs RPCs rejected after waiting for capacity.",
	})

	// MReconcileClientRoundSeconds splits the existing reconcile_rpc round
	// histogram by whether the gRPC/libp2p connection to this peer was
	// already in the client conn map when the round started (reused_conn)
	// or had to be established (new_conn). High p99 on new_conn with low
	// server total = stream setup tax, not server compute.
	MReconcileClientRoundSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_reconcile_client_round_seconds",
		Help:    "Per-round client-side ReconcileBlobs wall-clock split by gRPC connection reuse (new_conn|reused_conn).",
		Buckets: diagBuckets,
	}, []string{"call"})
)

// Force metric to appear even if there's no blobs to sync.
func init() {
	MSyncingWantedBlobs.WithLabelValues("syncing").Set(0)
	MSyncingWantedBlobs.WithLabelValues("groups").Set(0)
}

// netDialFunc is a function of the Seed P2P node that creates an instance
// of a Syncing RPC client for a given remote Device ID.
type netDialFunc func(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.SyncingClient, error)

// entityScope describes how to scope reconciliation for a single entity.
// Recursive and DepthOne are mutually exclusive: Recursive walks the entire
// subtree below the entity, DepthOne only its direct children.
type entityScope struct {
	Recursive bool
	DepthOne  bool
}

// subscriptionMap is a map of peer IDs to an IRI and the recursion scope to apply.
type subscriptionMap map[peer.ID]map[string]entityScope

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
	// Has must be a multihash-keyed lookup so the syncing pre-flight filter
	// can drop CIDs whose bytes we already have under a different codec —
	// see the preflight_has phase in syncResources.
	Has(context.Context, cid.Cid) (bool, error)
	GetAuthorizedSpacesForPeer(ctx context.Context, peerID peer.ID, requestedResources []blob.IRI) ([]core.Principal, error)
	GetSiteURL(ctx context.Context, space core.Principal) (string, error)
	ResolveSiteURL(ctx context.Context, siteURL string) (peer.AddrInfo, error)
	GetSpacesByAccount(ctx context.Context, accounts []core.Principal) (map[core.PrincipalUnsafeString][]core.Principal, error)
}

type protocolChecker struct {
	checker func(context.Context, peer.ID, string, ...protocol.ID) error
	version string
}

// Service implements syncing content over the P2P network.
type Service struct {
	cfg          config.Syncing
	log          *zap.Logger
	db           *sqlitex.Pool
	index        Index
	bitswap      bitswap
	rbsrClient   netDialFunc
	resources    ResourceAPI
	p2pClient    func(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.P2PClient, error)
	host         host.Host
	isConnCached func(peer.ID) bool
	pc           protocolChecker

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
	IsConnCached(peer.ID) bool
}

// NewService creates a new syncing service. Users should call Start() to start the periodic syncing.
func NewService(cfg config.Syncing, log *zap.Logger, db *sqlitex.Pool, indexer Index, net P2PNode, keyStore core.KeyStore) *Service {
	svc := &Service{
		cfg:          cfg,
		log:          log,
		db:           db,
		index:        indexer,
		bitswap:      net.Bitswap(),
		rbsrClient:   net.SyncingClient,
		p2pClient:    net.Client,
		host:         net.Libp2p().Host,
		isConnCached: net.IsConnCached,
		keyStore:     keyStore,
	}
	svc.pc = protocolChecker{
		checker: net.CheckHyperMediaProtocolVersion,
		version: net.ProtocolVersion(),
	}

	if cfg.MaxWorkers == 0 {
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

// SchedulerSnapshot returns a point-in-time view of the scheduler's
// internal counters and queue sizes. Safe to call from any goroutine.
// Used by /debug/network to surface whether preemption is firing in
// production.
func (s *Service) SchedulerSnapshot() SchedulerSnapshot {
	return s.scheduler.snapshot()
}

// TouchHotTask returns an existing task or creates a new ephemeral one.
// If a subscription task already exists, it wakes it up and returns its info.
//
// blobTypes is an optional allowlist of structural blob types to discover
// (e.g. ["Profile", "Ref", "Change"]); nil/empty disables filtering.
// recursive and depthOne are mutually exclusive: recursive walks the entire
// subtree below iri, depthOne only its direct children. Tasks with different
// recursion or blobTypes settings are tracked independently, so each is part
// of the task identity.
func (s *Service) TouchHotTask(iri blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string) TaskInfo {
	key := DiscoveryKey{
		IRI:       iri,
		Version:   version,
		Recursive: recursive,
		DepthOne:  depthOne,
		BlobTypes: BlobTypesString(blobTypes),
	}
	return s.scheduler.scheduleTask(key, time.Now(), schedOpts{isHot: true})
}

// SyncResult is a summary of one Sync loop iteration.
type SyncResult struct {
	NumSyncOK     int64
	NumSyncFailed int64
	Peers         []peer.ID
	Errs          []error
}

// maxPeerConcurrency bounds the number of peers a single discovery task syncs
// with simultaneously. The per-task peer pool is a rolling sliding window:
// gateways fill the first slots, then the remaining slots stream non-gateway
// peers in, with a new peer dispatched the moment any in-flight peer returns
// (see errgroup.SetLimit usage in syncWithManyPeers). With MaxWorkers=6 tasks
// and 20 peers each, the system-wide concurrent peer syncs are bounded at 120.
const maxPeerConcurrency = 20

// gatewayPIDs is the set of well-known gateway peer IDs. Gateways are
// well-connected infrastructure peers that are most likely to have content,
// so we sync with them first.
var gatewayPIDs = func() map[peer.ID]bool {
	m := make(map[peer.ID]bool, 3)
	for _, s := range []string{
		ipfs.ProductionGatewayPID,
		ipfs.StagingGatewayPID,
		ipfs.DevGatewayPID,
	} {
		pid, err := peer.Decode(s)
		if err == nil {
			m[pid] = true
		}
	}
	return m
}()

// syncWithManyPeers syncs with many peers in parallel, bounded by maxPeerConcurrency.
// Gateways are synced first because they are better-connected and more likely to
// have the requested content. blobTypes is an optional allowlist of structural
// blob types to reconcile; nil/empty disables the filter (all types). The same
// filter is applied uniformly to every peer in this call.
func (s *Service) syncWithManyPeers(ctx context.Context, subsMap subscriptionMap, store *authorizedStore, prog *Progress, auth *authInfo, blobTypes []string) (res SyncResult) {
	res.Peers = make([]peer.ID, len(subsMap))
	res.Errs = make([]error, len(subsMap))

	// One bitswap session for the entire discovery task instead of one per
	// peer-sync. boxo bitswap allocates a session goroutine plus a handful
	// of messagequeue / donthave-timeout goroutines per session, so with
	// maxPeerConcurrency=20 the prior per-peer-sync model spun up O(20)
	// sessions per task. Sharing within a task drops that to 1.
	bswap := s.bitswap.NewSession(ctx)

	var g errgroup.Group
	g.SetLimit(maxPeerConcurrency)

	dispatch := func(i int, pid peer.ID, eids map[string]entityScope) {
		res.Peers[i] = pid
		g.Go(func() error {
			var err error
			s.log.Debug("Syncing with peer", zap.String("PID", pid.String()))
			if xerr := s.syncWithPeer(ctx, pid, eids, store, prog, auth, blobTypes, bswap); xerr != nil {
				s.log.Debug("Could not sync with content", zap.String("PID", pid.String()), zap.Error(xerr))
				err = fmt.Errorf("failed to sync objects: %w", xerr)
			}

			res.Errs[i] = err
			if err == nil {
				atomic.AddInt64(&res.NumSyncOK, 1)
				prog.PeersSyncedOK.Add(1)
			} else {
				atomic.AddInt64(&res.NumSyncFailed, 1)
				prog.PeersFailed.Add(1)
			}
			return nil
		})
	}

	// First pass: gateways get the first concurrency slots.
	var i int
	for pid, eids := range subsMap {
		if gatewayPIDs[pid] {
			dispatch(i, pid, eids)
			i++
		}
	}
	// Second pass: everyone else.
	for pid, eids := range subsMap {
		if !gatewayPIDs[pid] {
			dispatch(i, pid, eids)
			i++
		}
	}

	_ = g.Wait()

	return res
}

func (s *Service) syncWithPeer(ctx context.Context, pid peer.ID, eids map[string]entityScope, store *authorizedStore, prog *Progress, auth *authInfo, blobTypes []string, bswap exchange.Fetcher) (err error) {
	// lastPhase tracks the most recent phase we entered. On error it's used to
	// classify the failure into an outcome counter label.
	lastPhase := "dial"
	defer func() {
		MSyncOutcomeTotal.WithLabelValues(classifySyncOutcome(lastPhase, err)).Inc()
	}()

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

	dialStart := time.Now()
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

	// Snapshot connection-cache state BEFORE dialing so the first reconcile
	// round can be labeled new_conn when we paid the dial cost vs.
	// reused_conn when the gRPC conn was already cached.
	connCachedBefore := s.isConnCached != nil && s.isConnCached(pid)

	c, err := func() (p2p.SyncingClient, error) {
		dialCtx, dialCancel := context.WithTimeout(ctx, 10*time.Second)
		defer dialCancel()
		return s.rbsrClient(dialCtx, pid)
	}()
	MSyncPeerPhaseSeconds.WithLabelValues("dial").Observe(time.Since(dialStart).Seconds())
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

	return syncResources(ctx, pid, c, s.index, bswap, s.log, eids, blobTypes, filteredStore, prog, &lastPhase, connCachedBefore)
}

// classifySyncOutcome maps a (phase, err) pair to a counter label.
// Phase is the most recent phase syncWithPeer entered; it's used when err
// has no other identifying marker.
func classifySyncOutcome(phase string, err error) string {
	if err == nil {
		return "ok"
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "preempted"
	}
	msg := err.Error()
	if strings.Contains(msg, "Hypermedia protocol") || strings.Contains(msg, "not a Hypermedia peer") {
		return "protocol_mismatch"
	}
	switch phase {
	case "dial":
		return "dial_failed"
	case "putmany":
		return "putmany_failed"
	default:
		return "rpc_error"
	}
}

func syncResources(
	ctx context.Context,
	pid peer.ID,
	c p2p.SyncingClient,
	idx Index,
	sess exchange.Fetcher,
	log *zap.Logger,
	eids map[string]entityScope,
	blobTypes []string,
	store rbsr.Store,
	prog *Progress,
	phase *string,
	connCachedAtStart bool,
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
	for eid, sc := range eids {
		filters = append(filters, &p2p.Filter{Resource: eid, Recursive: sc.Recursive, DepthOne: sc.DepthOne, Types: blobTypes})
	}

	var (
		allWants []cid.Cid
		wantsIdx = make(map[cid.Cid]int)
		rounds   int

		// We'll be reusing the slices for haves and wants on each round trip to reduce allocations.
		haves [][]byte
		wants [][]byte
	)
	*phase = "reconcile_rpc"
	for msg != nil {
		rounds++
		if rounds > 1000 {
			return fmt.Errorf("too many rounds of interactive syncing")
		}

		// One observation per ReconcileBlobs RPC call. The prior once-per-sync
		// timing hid cases where many cheap rounds accumulated vs. a single
		// slow round; per-round data makes that distinction visible.
		// Round 1 carries the new_conn/reused_conn label captured before the
		// dial; later rounds reuse the (now cached) gRPC conn by definition.
		connReuse := "reused_conn"
		if rounds == 1 && !connCachedAtStart {
			connReuse = "new_conn"
		}
		// reconcileRoundTimeout caps a single ReconcileBlobs RPC. Resets between
		// rounds so a multi-round sync isn't punished cumulatively. Sized with
		// ~3x headroom over the observed reused_conn p99 (4.79s) — generous
		// enough that healthy round-1 reconciles against gateways with big
		// filters complete, tight enough that a hung server doesn't dominate
		// the user-visible discovery wall-clock.
		const reconcileRoundTimeout = 15 * time.Second
		rpcStart := time.Now()
		roundCtx, roundCancel := context.WithTimeout(ctx, reconcileRoundTimeout)
		res, rerr := c.ReconcileBlobs(roundCtx, &p2p.ReconcileBlobsRequest{
			Ranges:  msg,
			Filters: filters,
		})
		roundCancel()
		rpcElapsed := time.Since(rpcStart).Seconds()
		MSyncPeerPhaseSeconds.WithLabelValues("reconcile_rpc").Observe(rpcElapsed)
		MReconcileClientRoundSeconds.WithLabelValues(connReuse).Observe(rpcElapsed)
		if rerr != nil {
			return rerr
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
			blockCid, werr := cid.Cast(want)
			if werr != nil {
				return werr
			}
			prog.BlobsDiscovered.Add(1)
			wantsIdx[blockCid] = len(allWants)
			allWants = append(allWants, blockCid)
		}
		log.Debug("Blobs Reconciled", zap.Int("round", rounds), zap.Int("wants", len(allWants)))
	}

	MSyncWantedBlobsPerPeer.Observe(float64(len(allWants)))

	if len(allWants) == 0 {
		log.Debug("Peer does not have new content")
		return nil
	}

	// Pre-flight Has filter. RBSR identifies items by full CID
	// (codec + multihash); the blockstore is keyed by multihash. Same
	// content tagged under different codecs across nodes (raw=85 vs
	// dag-pb=112 is the typical case) shows up as "they have, we don't"
	// in the diff. Without this filter the spurious wants pay full
	// network cost and get dropped at putBlock with the `exists`
	// outcome. We mirror what blockservice.GetBlock does upstream of
	// bitswap in the standard IPFS stack — bitswap.Session.GetBlocks
	// itself does NOT consult the local blockstore, so the filter has
	// to live here.
	*phase = "preflight_has"
	preflightStart := time.Now()
	filtered := allWants[:0]
	var preflightSkipped int
	for _, wc := range allWants {
		has, herr := idx.Has(ctx, wc)
		if herr != nil {
			// Don't silently drop on lookup error — better to fetch and
			// have putBlock bounce a duplicate than to skip a block we
			// genuinely need.
			filtered = append(filtered, wc)
			continue
		}
		if has {
			preflightSkipped++
			continue
		}
		filtered = append(filtered, wc)
	}
	allWants = filtered
	MSyncPeerPhaseSeconds.WithLabelValues("preflight_has").Observe(time.Since(preflightStart).Seconds())
	if preflightSkipped > 0 {
		MSyncPreflightSkipped.Add(float64(preflightSkipped))
		log.Debug("PreflightSkipped",
			zap.Int("skipped", preflightSkipped),
			zap.Int("remaining", len(allWants)),
		)
	}
	MSyncPreflightWantsPerPeer.Observe(float64(len(allWants)))

	if len(allWants) == 0 {
		log.Debug("Peer does not have new content (all wants filtered by preflight Has)")
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(len(allWants)))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(len(allWants)))

	*phase = "bitswap_fetch"
	bitswapStart := time.Now()
	ch, err := sess.GetBlocks(ctx, allWants)
	if err != nil {
		MSyncPeerPhaseSeconds.WithLabelValues("bitswap_fetch").Observe(time.Since(bitswapStart).Seconds())
		MSyncBitswapOutcome.WithLabelValues("ctx_done").Inc()
		return fmt.Errorf("failed to initiate bitswap session for syncing: %w", err)
	}

	// Streaming persist worker (per-peer). Bitswap is IO-bound (network),
	// PutMany is CPU/disk-bound (SQLite write tx + indexBlob). Pre-fix these
	// ran strictly sequentially: download all → accumulate → PutMany at the
	// end. That held the entire wantlist in RAM and lost everything when the
	// per-peer ctx fired before persist could begin. Streaming dispatches
	// small batches as they arrive and persists them on a detached ctx so
	// already-fetched bytes always land on disk.
	const persistBatchSize = 10
	const persistChCap = 4
	persistCtx := context.WithoutCancel(ctx)
	persistCh := make(chan []blocks.Block, persistChCap)
	persistDone := make(chan struct{})

	go func() {
		defer close(persistDone)
		for batch := range persistCh {
			putmanyStart := time.Now()
			err := idx.PutMany(persistCtx, batch)
			MSyncPeerPhaseSeconds.WithLabelValues("putmany").Observe(time.Since(putmanyStart).Seconds())
			if err != nil {
				MSyncPersistRollbackTotal.Inc()
				MSyncPersistRollbackBlocks.Add(float64(len(batch)))
				log.Warn("PutManyBatchRolledBack",
					zap.String("peerID", pid.String()),
					zap.Int("batchSize", len(batch)),
					zap.Error(err),
				)
				continue
			}
		}
	}()

	// bitswapOutcome is set by the download closure below and consumed by the
	// metric observations after it returns.
	var bitswapOutcome string
	// Tracks the wall-clock moment of the most recent received block so we
	// can record the gap between "last block in" and "loop exited" —
	// that gap distinguishes "channel closed right after last block"
	// (productive exit) from "we sat on the idle timer" (dead wait).
	lastBlockAt := bitswapStart
	var downloadedTotal int64
	batch := make([]blocks.Block, 0, persistBatchSize)
	flushBatch := func() {
		if len(batch) == 0 {
			return
		}
		// Hand off ownership; allocate a fresh slice for the next batch.
		persistCh <- batch
		batch = make([]blocks.Block, 0, persistBatchSize)
	}
	download := func() {
		const idleTimeout = 10 * time.Second
		t := time.NewTimer(idleTimeout)
		defer t.Stop()

		for {
			select {
			case blk, ok := <-ch:
				if !ok {
					// Channel closed. If ctx is dead the session was torn down
					// by cancellation; otherwise bitswap finished naturally.
					if ctx.Err() != nil {
						bitswapOutcome = "ctx_done"
					} else {
						bitswapOutcome = "complete"
					}
					return
				}
				t.Reset(idleTimeout)
				lastBlockAt = time.Now()
				prog.BlobsDownloaded.Add(1)
				downloadedTotal++
				batch = append(batch, blk)
				if len(batch) >= persistBatchSize {
					flushBatch()
				}
			case <-t.C:
				prog.BlobsFailed.Add(int32(len(allWants)) - prog.BlobsDownloaded.Load()) //nolint:gosec
				bitswapOutcome = "idle_timeout"
				return
			}
		}
	}

	download()
	flushBatch()     // partial trailing batch
	close(persistCh) // signal persist worker to drain and exit

	fetchElapsed := time.Since(bitswapStart).Seconds()
	MSyncPeerPhaseSeconds.WithLabelValues("bitswap_fetch").Observe(fetchElapsed)
	MSyncBitswapFetchSeconds.WithLabelValues(bitswapOutcome).Observe(fetchElapsed)
	MSyncBitswapOutcome.WithLabelValues(bitswapOutcome).Inc()
	MSyncBitswapLastBlockAge.WithLabelValues(bitswapOutcome).Observe(time.Since(lastBlockAt).Seconds())
	if len(allWants) > 0 {
		MSyncBitswapCompleteness.Observe(float64(downloadedTotal) / float64(len(allWants)))
	}

	if downloadedTotal == 0 {
		<-persistDone
		return nil
	}

	tracker := longrunning.Start(log, "ReconcileBlobsWrite", 30*time.Second,
		zap.String("peerID", pid.String()),
		zap.Int("wantedCount", len(allWants)),
		zap.Int64("downloadedCount", downloadedTotal),
	)
	defer func() {
		tracker.Finish(nil)
	}()

	*phase = "putmany"
	<-persistDone // wait for our per-peer persist worker to drain remaining batches
	return nil
}

// computeAuthInfo pre-computes authentication information for syncing.
// For each space being synced:
// 1. Check if we have the space's siteURL locally.
// 2. Resolve the siteURL to a peer ID.
// 3. Check if any local key has access to that space.
// 4. If so, map the siteURL peer to the keypair.
func (s *Service) computeAuthInfo(ctx context.Context, eids map[string]entityScope) *authInfo {
	info := &authInfo{
		peerKeys:  make(map[peer.ID][]*core.KeyPair),
		addrInfos: make(map[peer.ID]peer.AddrInfo),
	}

	if s.keyStore == nil {
		return info
	}

	keyPairs, err := s.keyStore.ListKeyPairs(ctx)
	if err != nil || len(keyPairs) == 0 {
		return info
	}

	localAccounts := make([]core.Principal, 0, len(keyPairs))
	for _, kp := range keyPairs {
		if kp.KeyPair == nil {
			continue
		}
		localAccounts = append(localAccounts, kp.Principal())
	}
	if len(localAccounts) == 0 {
		return info
	}

	spacesByAccount, err := s.index.GetSpacesByAccount(ctx, localAccounts)
	if err != nil {
		return info
	}

	// Collect unique spaces from entities being synced.
	spaces := make(map[core.PrincipalUnsafeString]core.Principal)
	for eid := range eids {
		iri := blob.IRI(eid)
		space, _, err := iri.SpacePath()
		if err != nil {
			continue
		}
		spaces[space.UnsafeString()] = space
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
		for _, kp := range keyPairs {
			if kp.KeyPair == nil {
				continue
			}
			for _, authSpace := range spacesByAccount[kp.Principal().UnsafeString()] {
				if authSpace.Equal(space) {
					// This key has access to the space. Add to peerKeys.
					info.peerKeys[addrInfo.ID] = append(info.peerKeys[addrInfo.ID], kp.KeyPair)
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

package syncing

import (
	"context"
	"crypto/sha256"
	"sort"
	"sync"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// loadStore cache: deduplicate the expensive rebuild of the pre-filter
// RBSR store across multiple ReconcileBlobs rounds (same peer, successive
// rounds of one negotiation) and across multiple peers asking with the
// same filter shape. The build cost is `loadRBSRStore` plus its temp-table
// INSERTs — the dominant per-call work on the writer-slot side of
// /debug/sqlite and the reason the daemon saw 10 s `begin_wait` timeouts
// under sustained churn.
//
// Trade-off, accepted on purpose: a peer that asks for dkeys whose
// pre-filter store was built up to storeCacheTTL ago will see that older
// snapshot, NOT the latest DB state. New blobs ingested in the meantime
// are picked up by the *next* reconciliation session whose miss forces
// a rebuild. This matches the existing "many goroutines under
// SyncWithMany may each redundantly bitswap a blob a sibling already
// pulled" tradeoff: we accept some staleness for less work overall.
//
// Correctness still holds across RBSR rounds within one negotiation:
// the cached entry is sealed and immutable, so range fingerprints stay
// stable as long as the entry is served. Per-peer authorization is
// applied at the call site via `(*authorizedStore).WithFilter`.

const (
	// storeCacheTTL is the absolute lifetime of a cached entry, measured
	// from build time. A hit does NOT refresh it; once the deadline
	// passes the entry is lazy-evicted on the next Get and the next
	// reader pays for a rebuild. 1 s amortises a ~150 ms p99 build
	// across all peers asking the same dkeys in that window, and caps
	// visible staleness for a fresh write at 1 s.
	storeCacheTTL = 1 * time.Second

	// storeCacheCap bounds distinct filter shapes held simultaneously.
	// Filter shapes in practice are small in number (per resource being
	// reconciled + recursion / type flags), so 64 leaves comfortable
	// headroom. Eviction is LRU on overflow.
	storeCacheCap = 64

)

// storeCacheMaxItems is the per-entry item-count cap. Stores larger
// than this are still built and returned to the current caller but
// NOT inserted into the cache — they consume too much memory for
// the reuse benefit they bring. Recursive account-root filters
// regularly produce stores of hundreds of thousands of CIDs; with
// the LRU cap of 64 entries that would pin gigabytes of memory and
// trigger OOM (observed 2026-05-22). For small per-document filter
// shapes (the common syncing case), stores stay well under this
// threshold and the cache still serves its purpose.
//
// Memory bound: 10 000 items × ~50 B/Item × 64 cache entries ≈ 32 MB
// worst-case cache footprint, safely below any reasonable cgroup cap.
//
// `var` (not `const`) so tests can lower it without exercising
// hundreds of thousands of inserts. Production callers must NOT mutate
// it from non-test code.
var storeCacheMaxItems = 10_000

// storeFingerprint is the cache key: a deterministic hash of a sorted
// DiscoveryKey set. Identical filter shapes (modulo Go map iteration
// order) produce identical fingerprints.
type storeFingerprint [sha256.Size]byte

// storeCacheEntry pins one pre-filter store. Expiry is fixed at Put time
// and does NOT slide on hits; readers see a stable view for at most
// storeCacheTTL after the entry was built.
type storeCacheEntry struct {
	store   *authorizedStore // sealed, pre-filter
	fp      storeFingerprint
	expires time.Time // absolute deadline, mutated only under loadStoreCache.mu
}

// loadStoreCache is the cross-peer, fingerprint-keyed cache for
// pre-filter RBSR stores. Concurrency-safe; one instance per daemon.
type loadStoreCache struct {
	mu      sync.Mutex
	entries map[storeFingerprint]*storeCacheEntry
	// order tracks LRU recency; most-recently-touched at the end. Linear
	// scan on Touch is fine at cap=64.
	order []storeFingerprint

	cap int
	ttl time.Duration
	now func() time.Time // overridable for tests
}

func newLoadStoreCache() *loadStoreCache {
	return &loadStoreCache{
		entries: make(map[storeFingerprint]*storeCacheEntry, storeCacheCap),
		order:   make([]storeFingerprint, 0, storeCacheCap),
		cap:     storeCacheCap,
		ttl:     storeCacheTTL,
		now:     time.Now,
	}
}

var (
	mStoreCacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_reconcile_store_cache_hits_total",
		Help: "Pre-filter RBSR store reuse cache hits in Server.loadStore.",
	})
	mStoreCacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_reconcile_store_cache_misses_total",
		Help: "Pre-filter RBSR store reuse cache misses (built fresh).",
	})
	mStoreCacheSkipsTooLarge = promauto.NewCounter(prometheus.CounterOpts{
		Name: "seed_reconcile_store_cache_skips_too_large_total",
		Help: "Built stores not inserted into the cache because their item count exceeded storeCacheMaxItems (recursive-root discoveries typically).",
	})
)

// Get returns a cached entry for fp if one exists and has not expired.
// The entry's deadline is NOT refreshed on hit: callers see a stable
// view until the original deadline passes, then the next Get evicts
// the expired entry and forces a rebuild.
func (c *loadStoreCache) Get(fp storeFingerprint) (*storeCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[fp]
	if !ok {
		return nil, false
	}
	if c.now().After(e.expires) {
		delete(c.entries, fp)
		c.lruRemoveLocked(fp)
		return nil, false
	}
	c.lruTouchLocked(fp)
	return e, true
}

// Put inserts (or replaces) an entry and stamps an absolute deadline
// at now+ttl. Evicts the least-recently-used entry on overflow.
//
// Concurrency: two builds racing on the same fingerprint both call Put;
// last writer wins. The work is wasted but the result is the same — the
// cache stays internally consistent. Single-flighting could eliminate
// this but isn't worth the complexity given how infrequently
// simultaneous-cold-start collisions happen in practice.
func (c *loadStoreCache) Put(e *storeCacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e.expires = c.now().Add(c.ttl)
	if _, exists := c.entries[e.fp]; exists {
		c.entries[e.fp] = e
		c.lruTouchLocked(e.fp)
		return
	}
	c.entries[e.fp] = e
	c.order = append(c.order, e.fp)
	if len(c.order) > c.cap {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.entries, oldest)
	}
}

// Len returns the number of currently-cached entries. Test-only helper.
func (c *loadStoreCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

func (c *loadStoreCache) lruTouchLocked(fp storeFingerprint) {
	for i := range c.order {
		if c.order[i] == fp {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
	c.order = append(c.order, fp)
}

func (c *loadStoreCache) lruRemoveLocked(fp storeFingerprint) {
	for i := range c.order {
		if c.order[i] == fp {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

// computeStoreFingerprint derives a deterministic key from a DiscoveryKey
// set. Order-independent: the dkeys slice is sorted before hashing so
// two callers with semantically-equal filter sets produce the same key
// regardless of Go map iteration order.
func computeStoreFingerprint(dkeys map[DiscoveryKey]struct{}) storeFingerprint {
	keys := make([]DiscoveryKey, 0, len(dkeys))
	for k := range dkeys {
		keys = append(keys, k)
	}
	sortDiscoveryKeys(keys)

	h := sha256.New()
	for _, k := range keys {
		h.Write([]byte(k.IRI))
		h.Write([]byte{0})
		h.Write([]byte(k.Version))
		h.Write([]byte{0})
		if k.Recursive {
			h.Write([]byte{1})
		} else {
			h.Write([]byte{0})
		}
		if k.DepthOne {
			h.Write([]byte{1})
		} else {
			h.Write([]byte{0})
		}
		h.Write([]byte(k.BlobTypes))
		h.Write([]byte{0})
	}
	var fp storeFingerprint
	copy(fp[:], h.Sum(nil))
	return fp
}

// loadOrReusePrefilterStore returns a sealed, pre-filter authorizedStore
// for dkeys. On cache hit, returns the shared entry; on miss, builds
// fresh via loadRBSRStore inside a WithSave scope and caches the result.
// Callers apply per-request authorization via (*authorizedStore).WithFilter
// on the returned store; the cache stores the unfiltered shape.
//
// The cache parameter must be the per-daemon instance (typically
// Server.cache). Sharing a single cache across daemons would
// cross-contaminate: two daemons with different DBs have different "what
// I have" answers for the same dkeys, but the fingerprint cannot
// distinguish them — only the cache's identity can. Tests that spin up
// multiple in-process daemons rely on this isolation.
func loadOrReusePrefilterStore(ctx context.Context, cache *loadStoreCache, db *sqlitex.Pool, dkeys map[DiscoveryKey]struct{}) (*authorizedStore, error) {
	fp := computeStoreFingerprint(dkeys)
	if e, ok := cache.Get(fp); ok {
		mStoreCacheHits.Inc()
		return e.store, nil
	}
	mStoreCacheMisses.Inc()

	store := newAuthorizedStore()
	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return nil, err
	}
	if err := store.Seal(); err != nil {
		return nil, err
	}
	// Cap retained cache size by item count. Outsized stores (recursive
	// account-root discoveries) were observed pinning hundreds of MB
	// per entry × 64 LRU slots and OOM-killing the daemon. Skipping the
	// Put leaves the request-scoped store for GC once the caller releases
	// it; the current request still gets the build it paid for.
	if store.Size() > storeCacheMaxItems {
		mStoreCacheSkipsTooLarge.Inc()
		return store, nil
	}
	cache.Put(&storeCacheEntry{
		store: store,
		fp:    fp,
	})
	return store, nil
}

// sortDiscoveryKeys orders a slice of DiscoveryKey deterministically.
// Exported (lowercase) so fillTables can reuse the same comparator when
// iterating dkeys for INSERTs — that determinism is what lets two
// "logically equal" dkeys sets produce byte-identical stores, which is
// the precondition for cache reuse to be correct.
func sortDiscoveryKeys(keys []DiscoveryKey) {
	sort.Slice(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.IRI != b.IRI {
			return a.IRI < b.IRI
		}
		if a.Version != b.Version {
			return a.Version < b.Version
		}
		if a.Recursive != b.Recursive {
			return !a.Recursive
		}
		if a.DepthOne != b.DepthOne {
			return !a.DepthOne
		}
		return a.BlobTypes < b.BlobTypes
	})
}

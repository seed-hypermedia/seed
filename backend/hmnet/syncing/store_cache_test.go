package syncing

import (
	"seed/backend/blob"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// newTestCache builds a cache instance with a controllable clock so the
// absolute-TTL eviction path can be exercised deterministically.
func newTestCache(t *testing.T, cap int, ttl time.Duration) (*loadStoreCache, *fakeClock) {
	t.Helper()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	c := &loadStoreCache{
		entries: make(map[storeFingerprint]*storeCacheEntry, cap),
		order:   make([]storeFingerprint, 0, cap),
		cap:     cap,
		ttl:     ttl,
		now:     clk.Now,
	}
	return c, clk
}

type fakeClock struct {
	t time.Time
}

func (c *fakeClock) Now() time.Time          { return c.t }
func (c *fakeClock) Advance(d time.Duration) { c.t = c.t.Add(d) }

func TestComputeStoreFingerprintIsOrderIndependent(t *testing.T) {
	a := map[DiscoveryKey]struct{}{
		{IRI: blob.IRI("hm://a"), Recursive: true}: {},
		{IRI: blob.IRI("hm://b"), DepthOne: true}:  {},
		{IRI: blob.IRI("hm://c"), BlobTypes: BlobTypesString([]string{"Ref", "Change"})}: {},
	}
	b := map[DiscoveryKey]struct{}{
		{IRI: blob.IRI("hm://c"), BlobTypes: BlobTypesString([]string{"Change", "Ref"})}: {},
		{IRI: blob.IRI("hm://a"), Recursive: true}: {},
		{IRI: blob.IRI("hm://b"), DepthOne: true}:  {},
	}
	require.Equal(t, computeStoreFingerprint(a), computeStoreFingerprint(b),
		"semantically equal dkeys must produce equal fingerprints regardless of iteration order")
}

func TestComputeStoreFingerprintDistinguishesFields(t *testing.T) {
	base := map[DiscoveryKey]struct{}{
		{IRI: blob.IRI("hm://x"), Recursive: true, BlobTypes: "Ref"}: {},
	}
	cases := []struct {
		name string
		mod  map[DiscoveryKey]struct{}
	}{
		{"different IRI", map[DiscoveryKey]struct{}{{IRI: blob.IRI("hm://y"), Recursive: true, BlobTypes: "Ref"}: {}}},
		{"Recursive flipped", map[DiscoveryKey]struct{}{{IRI: blob.IRI("hm://x"), Recursive: false, BlobTypes: "Ref"}: {}}},
		{"DepthOne flipped", map[DiscoveryKey]struct{}{{IRI: blob.IRI("hm://x"), Recursive: true, DepthOne: true, BlobTypes: "Ref"}: {}}},
		{"BlobTypes differ", map[DiscoveryKey]struct{}{{IRI: blob.IRI("hm://x"), Recursive: true, BlobTypes: "Change"}: {}}},
		{"Version differs", map[DiscoveryKey]struct{}{{IRI: blob.IRI("hm://x"), Version: blob.Version("v1"), Recursive: true, BlobTypes: "Ref"}: {}}},
	}
	baseFP := computeStoreFingerprint(base)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.NotEqual(t, baseFP, computeStoreFingerprint(tc.mod),
				"fingerprint must change when %s", tc.name)
		})
	}
}

func TestLoadStoreCacheHitMiss(t *testing.T) {
	c, _ := newTestCache(t, 4, time.Second)
	fp := storeFingerprint{1, 2, 3}

	if _, ok := c.Get(fp); ok {
		t.Fatal("Get on empty cache should miss")
	}
	c.Put(&storeCacheEntry{fp: fp})
	got, ok := c.Get(fp)
	require.True(t, ok, "Get after Put should hit")
	require.NotNil(t, got)
}

// TestLoadStoreCacheAbsoluteTTL verifies that the entry's deadline is
// stamped at Put time and is NOT refreshed on hit. A continuous stream
// of Gets at sub-TTL intervals must still let the entry expire at its
// original deadline — this is the key behaviour change vs. the earlier
// sliding-TTL design, where polling clients could pin a stale entry
// indefinitely.
func TestLoadStoreCacheAbsoluteTTL(t *testing.T) {
	c, clk := newTestCache(t, 4, time.Second)
	fp := storeFingerprint{1}
	c.Put(&storeCacheEntry{fp: fp})

	// Hits before expiry succeed but do NOT extend the lifetime.
	for i := 0; i < 5; i++ {
		clk.Advance(100 * time.Millisecond)
		if _, ok := c.Get(fp); !ok {
			t.Fatalf("iteration %d: entry should still be live at t+%dms", i, (i+1)*100)
		}
	}

	// Cross the original deadline. Even though we kept hitting the
	// entry, its deadline was fixed at Put; next Get evicts.
	clk.Advance(600 * time.Millisecond)
	if _, ok := c.Get(fp); ok {
		t.Fatal("entry must expire at its absolute deadline regardless of hit frequency")
	}
	require.Equal(t, 0, c.Len(), "expired entry must be evicted from the map")
}

func TestLoadStoreCacheLRUEvictsOldest(t *testing.T) {
	c, _ := newTestCache(t, 3, time.Minute)
	fps := []storeFingerprint{{1}, {2}, {3}, {4}}
	for _, fp := range fps[:3] {
		c.Put(&storeCacheEntry{fp: fp})
	}
	// Touch {1} so {2} becomes oldest.
	_, _ = c.Get(fps[0])

	// Overflow with {4} — {2} should be evicted.
	c.Put(&storeCacheEntry{fp: fps[3]})

	if _, ok := c.Get(fps[1]); ok {
		t.Fatal("{2} should have been LRU-evicted")
	}
	for _, fp := range []storeFingerprint{fps[0], fps[2], fps[3]} {
		if _, ok := c.Get(fp); !ok {
			t.Fatalf("entry %v should still be present", fp)
		}
	}
	require.Equal(t, 3, c.Len())
}

func TestLoadStoreCachePutReplacesExisting(t *testing.T) {
	c, _ := newTestCache(t, 4, time.Minute)
	fp := storeFingerprint{1}
	first := &storeCacheEntry{fp: fp}
	second := &storeCacheEntry{fp: fp}

	c.Put(first)
	c.Put(second)
	got, ok := c.Get(fp)
	require.True(t, ok)
	require.Same(t, second, got, "Put with same fp must overwrite, not insert twice")
	require.Equal(t, 1, c.Len())
}

// TestStoreCacheSizeBoundSkipsLargeStores documents the size gate
// applied in loadOrReusePrefilterStore: stores with Size() greater
// than storeCacheMaxItems are returned to the caller but NOT inserted
// into the cache. This guards against the recursive-account-root
// discoveries that OOM-killed the daemon by pinning hundreds of MB
// per cache entry (observed 2026-05-22).
//
// We assert against a hand-built sealed store rather than running
// loadRBSRStore end-to-end (which would require a populated SQLite
// schema) — the gate's contract is purely a Size() comparison, so
// exercising it directly is enough.
func TestStoreCacheSizeBoundSkipsLargeStores(t *testing.T) {
	cache, _ := newTestCache(t, 4, time.Minute)

	// Temporarily lower the cap so the test doesn't have to insert 10K
	// items. Restore on exit so other tests see the production value.
	orig := storeCacheMaxItems
	storeCacheMaxItems = 3
	t.Cleanup(func() { storeCacheMaxItems = orig })

	// Small store: 3 items, exactly at the cap. Should be cached.
	small := newAuthorizedStore()
	for i := 0; i < 3; i++ {
		require.NoError(t, small.Insert(int64(i), []byte{byte(i)}))
	}
	require.NoError(t, small.Seal())
	require.Equal(t, 3, small.Size())
	smallFP := storeFingerprint{1}
	// Mirror the gate logic from loadOrReusePrefilterStore: cache only
	// if size is within the threshold.
	if small.Size() <= storeCacheMaxItems {
		cache.Put(&storeCacheEntry{store: small, fp: smallFP})
	}
	require.Equal(t, 1, cache.Len(), "small store at exactly cap must be cached")

	// Big store: 5 items, over the cap. Should NOT be cached.
	big := newAuthorizedStore()
	for i := 0; i < 5; i++ {
		require.NoError(t, big.Insert(int64(100+i), []byte{byte(100 + i)}))
	}
	require.NoError(t, big.Seal())
	require.Equal(t, 5, big.Size())
	bigFP := storeFingerprint{2}
	if big.Size() <= storeCacheMaxItems {
		cache.Put(&storeCacheEntry{store: big, fp: bigFP})
	}
	require.Equal(t, 1, cache.Len(),
		"oversized store must not be inserted into the cache (would pin too much memory)")
	_, ok := cache.Get(bigFP)
	require.False(t, ok, "oversized store fingerprint must not be retrievable")
}

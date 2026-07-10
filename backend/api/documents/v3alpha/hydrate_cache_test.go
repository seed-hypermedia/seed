package documents

import (
	"context"
	"fmt"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"sync"
	"testing"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

type signedChange struct {
	cid cid.Cid
	ch  *blob.Change
}

// replayForCache builds `changesN` signed changes totalling ~`moves` deep block
// moves, then returns a fresh document with all applied — a cold read from
// storage. Deep nesting is the pathological (superlinear) hydrate case.
func replayForCache(t testing.TB, iri string, moves, changesN int) *docmodel.Document {
	t.Helper()
	alice := coretest.NewTester("alice").Account
	perChange := moves / changesN
	if perChange < 1 {
		perChange = 1
	}
	var history []signedChange
	created, parent := 0, ""
	for cIdx := 0; cIdx < changesN; cIdx++ {
		d := must.Do2(docmodel.New(blob.IRI(iri), cclock.New()))
		for _, s := range history {
			must.Do(d.ApplyChange(s.cid, s.ch))
		}
		if cIdx == 0 {
			must.Do(d.SetMetadata("title", "Bench"))
		}
		for i := 0; i < perChange; i++ {
			id := fmt.Sprintf("b%d", created)
			must.Do(d.MoveBlock(id, parent, ""))
			parent = id
			created++
		}
		hb := must.Do2(d.SignChange(alice))
		history = append(history, signedChange{cid: hb.CID, ch: hb.Decoded})
	}
	d := must.Do2(docmodel.New(blob.IRI(iri), cclock.New()))
	for _, s := range history {
		must.Do(d.ApplyChange(s.cid, s.ch))
	}
	return d
}

func TestHydrateCacheCorrectness(t *testing.T) {
	c := newHydrateCache()
	ctx := context.Background()
	iri := "hm://alice/cache"

	doc := replayForCache(t, iri, 400, 8)

	// Uncached reference hydration.
	want := must.Do2(doc.Hydrate(ctx))

	// Cached hydration must be equal.
	got := must.Do2(c.get(ctx, iri, doc))
	require.True(t, proto.Equal(want, got), "cached hydrate must equal direct hydrate")

	// Second call is a cache hit and must still equal.
	got2 := must.Do2(c.get(ctx, iri, doc))
	require.True(t, proto.Equal(want, got2), "cache-hit hydrate must equal direct hydrate")

	// The returned protos must be independent clones: mutating one must not
	// corrupt the shared cache entry.
	got.Metadata = nil
	got3 := must.Do2(c.get(ctx, iri, doc))
	require.True(t, proto.Equal(want, got3), "mutating a returned proto must not corrupt the cache")
}

func TestHydrateCacheInvalidatesOnNewVersion(t *testing.T) {
	c := newHydrateCache()
	ctx := context.Background()
	iri := "hm://alice/cache2"

	docV1 := replayForCache(t, iri, 100, 4)
	v1 := docV1.Version().String()
	got1 := must.Do2(c.get(ctx, iri, docV1))
	require.NotEmpty(t, got1.Content)

	// A longer-history doc at the same IRI resolves to a different version and
	// must not return the stale v1 cache entry.
	docV2 := replayForCache(t, iri, 200, 8)
	v2 := docV2.Version().String()
	require.NotEqual(t, v1, v2, "different histories must have different versions")

	got2 := must.Do2(c.get(ctx, iri, docV2))
	require.Equal(t, v2, got2.Version)
	require.NotEqual(t, got1.Version, got2.Version, "cache must key on version, not just IRI")
}

func TestHydrateCacheSingleflightConcurrent(t *testing.T) {
	c := newHydrateCache()
	ctx := context.Background()
	iri := "hm://alice/cache3"
	doc := replayForCache(t, iri, 300, 6)
	want := must.Do2(doc.Hydrate(ctx))

	var wg sync.WaitGroup
	const n = 64
	results := make([]*documents.Document, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got, err := c.get(ctx, iri, doc)
			require.NoError(t, err)
			results[i] = got
		}(i)
	}
	wg.Wait()
	for i := 0; i < n; i++ {
		require.True(t, proto.Equal(want, results[i]), "concurrent result %d must match", i)
	}
}

func BenchmarkHydrateCacheHitVsMiss(b *testing.B) {
	ctx := context.Background()
	iri := "hm://alice/benchcache"
	doc := replayForCache(b, iri, 4000, 80)

	b.Run("uncached", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_, err := doc.Hydrate(ctx)
			require.NoError(b, err)
		}
	})

	b.Run("cached", func(b *testing.B) {
		c := newHydrateCache()
		_, err := c.get(ctx, iri, doc) // warm
		require.NoError(b, err)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := c.get(ctx, iri, doc)
			require.NoError(b, err)
		}
	})
}

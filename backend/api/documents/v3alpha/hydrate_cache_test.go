package documents

import (
	"context"
	"fmt"
	"seed/backend/api/apitest"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"sync"
	"testing"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func TestCachedDocumentServesPinnedVersions(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()
	account := alice.me.Account.PublicKey.String()
	ns := alice.me.Account.Principal()

	v1, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/doc",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "First"},
			}},
		},
	})
	require.NoError(t, err)

	v2, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/doc",
		BaseVersion:    v1.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Second"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotEqual(t, v1.Version, v2.Version)

	iri := must.Do2(makeIRI(ns, "/doc"))
	heads := must.Do2(docmodel.Version(v1.Version).Parse())

	// Start cold, so the first read is the one that has to replay the changes.
	alice.hydrated.lru.Purge()
	_, ok, err := alice.cachedDocument(ctx, iri, ns, "/doc", heads)
	require.NoError(t, err)
	require.False(t, ok, "nothing is cached yet, the caller must do the full load")

	want, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: account, Path: "/doc", Version: v1.Version})
	require.NoError(t, err)
	require.Equal(t, v1.Version, want.Version)

	cached, ok, err := alice.cachedDocument(ctx, iri, ns, "/doc", heads)
	require.NoError(t, err)
	require.True(t, ok, "a version that was read before must not be replayed again")
	require.True(t, proto.Equal(want, cached))

	got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: account, Path: "/doc", Version: v1.Version})
	require.NoError(t, err)
	require.True(t, proto.Equal(want, got))

	res, err := alice.GetResource(ctx, &documents.GetResourceRequest{Iri: string(iri) + "?v=" + v1.Version})
	require.NoError(t, err)
	require.True(t, proto.Equal(want, res.GetDocument()))
	require.Equal(t, v1.Version, res.Version)

	// The pinned entry must not leak into reads of the current version.
	latest, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: account, Path: "/doc"})
	require.NoError(t, err)
	require.Equal(t, v2.Version, latest.Version)

	// A version of another document is not a version of this one, cached or not.
	other, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/other",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Other"},
			}},
		},
	})
	require.NoError(t, err)
	_, ok, err = alice.cachedDocument(ctx, iri, ns, "/doc", must.Do2(docmodel.Version(other.Version).Parse()))
	require.NoError(t, err)
	require.False(t, ok)
}

func TestCachedDocumentDeniesPrivatePinnedVersions(t *testing.T) {
	t.Parallel()

	// PublicOnly simulates a gateway, which must never serve private documents.
	alice := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	ctx := context.Background()
	account := alice.me.Account.PublicKey.String()
	ns := alice.me.Account.Principal()

	secret, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/secret",
		Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Secret"},
			}},
		},
	})
	require.NoError(t, err)

	iri := must.Do2(makeIRI(ns, "/secret"))
	heads := must.Do2(docmodel.Version(secret.Version).Parse())

	// Put the hydrated document into the cache behind the API's back, which is
	// the worst case: the entry exists, so only the access check stands in the way.
	doc, err := alice.loadDocument(ctx, ns, "/secret", heads, false)
	require.NoError(t, err)
	_, err = alice.hydrated.get(ctx, string(iri), doc)
	require.NoError(t, err)
	_, ok := alice.hydrated.peek(hydrateCacheKey(string(iri), secret.Version))
	require.True(t, ok, "the test needs the entry to be cached")

	_, ok, err = alice.cachedDocument(ctx, iri, ns, "/secret", heads)
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	require.False(t, ok)

	_, err = alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: account, Path: "/secret", Version: secret.Version})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = alice.GetResource(ctx, &documents.GetResourceRequest{Iri: string(iri) + "?v=" + secret.Version})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

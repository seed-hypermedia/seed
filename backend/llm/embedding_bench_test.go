package llm

import (
	"fmt"
	"math/rand/v2"
	"testing"
	"time"

	"seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

const (
	searchCorpusSpace      = "hm://space"
	searchCorpusOtherSpace = "hm://other"
	searchCorpusDocBlocks  = 10
)

var searchCorpusTypes = map[string]bool{"title": true, "profile": true, "contact": true, "document": true, "comment": true}

// newSearchCorpus returns an embedder over n random document-block embeddings,
// half of them under searchCorpusSpace and half under searchCorpusOtherSpace,
// so an account-scoped search filters vectors against a list of n/2 fts ids.
func newSearchCorpus(tb testing.TB, n int) *Embedder {
	tb.Helper()
	ctx := tb.Context()
	db := storage.MakeTestDB(tb)
	rng := rand.NewChaCha8([32]byte{})

	require.NoError(tb, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys(id, principal) VALUES (1, 'author');`, nil); err != nil {
			return err
		}

		vec := make([]byte, 384)
		for doc := 0; doc*searchCorpusDocBlocks < n; doc++ {
			id := int64(doc + 1)

			space := searchCorpusSpace
			if doc%2 == 1 {
				space = searchCorpusOtherSpace
			}

			if err := sqlitex.Exec(conn, `INSERT INTO blobs(id, multihash, codec, size) VALUES (?, ?, 85, 0);`, nil, id, fmt.Appendf(nil, "hash-%d", id)); err != nil {
				return err
			}

			if err := sqlitex.Exec(conn, `INSERT INTO resources(id, iri) VALUES (?, ?);`, nil, id, fmt.Sprintf("%s/doc-%d", space, doc)); err != nil {
				return err
			}

			if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs(id, type, resource, author) VALUES (?, 'Change', ?, 1);`, nil, id, id); err != nil {
				return err
			}

			for block := range searchCorpusDocBlocks {
				ftsID := int64(doc*searchCorpusDocBlocks + block + 1)
				if err := sqlitex.Exec(conn, `INSERT INTO fts_index(rowid, blob_id, block_id, version, type, ts) VALUES (?, ?, ?, 'v1', 'document', 0);`, nil, ftsID, id, fmt.Sprintf("block-%d", block)); err != nil {
					return err
				}

				_, _ = rng.Read(vec)
				if err := sqlitex.Exec(conn, `INSERT INTO embeddings(multilingual_minilm_l12_v2, fts_id) VALUES (vec_int8(?), ?);`, nil, vec, ftsID); err != nil {
					return err
				}

				if err := sqlitex.Exec(conn, `INSERT INTO embeddings_index(fts_id) VALUES (?);`, nil, ftsID); err != nil {
					return err
				}
			}
		}

		return sqlitex.SetKV(ctx, conn, kvEmbeddingModelChecksumKey, "fake-checksum", true)
	}))

	tm := taskmanager.NewTaskManager()
	tm.UpdateGlobalState(daemonpb.State_ACTIVE)
	e, err := NewEmbedder(db, &fakeEmbeddingBackend{contextSize: 1000}, zap.NewNop(), tm, WithModel(DefaultEmbeddingModel), WithInterval(time.Hour))
	require.NoError(tb, err)
	e.Init(ctx)
	require.Eventually(tb, func() bool {
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.modelLoaded
	}, 5*time.Second, 10*time.Millisecond)
	return e
}

// TestSemanticSearchAccountFilterMatchesUnfiltered checks that an account-scoped
// search returns exactly the in-scope subset of an unscoped search.
func TestSemanticSearchAccountFilterMatchesUnfiltered(t *testing.T) {
	const n = 2000

	e := newSearchCorpus(t, n)

	all, err := e.SemanticSearch(t.Context(), "query", n, searchCorpusTypes, "*", 0, false, false)
	require.NoError(t, err)
	want := SearchResultMap{}
	for ftsID, score := range all {
		if (ftsID-1)/searchCorpusDocBlocks%2 == 0 {
			want[ftsID] = score
		}
	}

	require.NotEmpty(t, want)

	got, err := e.SemanticSearch(t.Context(), "query", n, searchCorpusTypes, searchCorpusSpace+"*", 0, false, false)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

// BenchmarkSemanticSearchAccountFilter measures the account-scoped semantic leg of hybrid search.
func BenchmarkSemanticSearchAccountFilter(b *testing.B) {
	for _, n := range []int{10_000, 40_000, 160_000} {
		b.Run(fmt.Sprintf("vectors=%d", n), func(b *testing.B) {
			e := newSearchCorpus(b, n)
			b.ResetTimer()
			for b.Loop() {
				_, err := e.SemanticSearch(b.Context(), "query", 600, searchCorpusTypes, searchCorpusSpace+"*", 0.45, false, false)
				require.NoError(b, err)
			}
		})
	}
}

package docmodel

import (
	"context"
	"fmt"
	"os"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

func mustNow() time.Time { return time.Now() }

func sinceMs(t time.Time) float64 { return float64(time.Since(t).Microseconds()) / 1000.0 }

// skipUnlessHydrateBench guards the O(n^2) scaling diagnostics. They build
// documents with thousands of deeply-nested block moves, which is intentionally
// slow (that's the point — it demonstrates the superlinear hydrate cost) and
// far too slow under the race detector for the normal CI test budget. They are
// diagnostic/proof tools, not regression tests, so they only run when explicitly
// requested via RUN_HYDRATE_BENCH=1 (and never under -short).
func skipUnlessHydrateBench(t *testing.T) {
	t.Helper()
	if testing.Short() || os.Getenv("RUN_HYDRATE_BENCH") == "" {
		t.Skip("diagnostic scaling test; set RUN_HYDRATE_BENCH=1 to run")
	}
}

func blobIRI(s string) blob.IRI { return blob.IRI(s) }

// buildDocWithHistory builds a document whose move-op log has roughly `moves`
// entries, spread across `changesN` changes to mimic a real edit history.
// Every block is appended at the end of the root list, then a fraction are
// re-moved, so the accumulated op log grows with total lifetime edits.
type signedChange struct {
	cid cid.Cid
	ch  *blob.Change
}

func buildDocWithHistory(tb testing.TB, moves int, changesN int) *Document {
	tb.Helper()
	return replayHistory(tb, "hm://alice/bench", moves, changesN, false)
}

// buildDeepDocWithHistory builds a *deep* tree (each block child of the
// previous), which is the pathological case for isAncestor: its ancestor
// walk is O(depth), so State() becomes O(moves * depth).
func buildDeepDocWithHistory(tb testing.TB, moves int, changesN int) *Document {
	tb.Helper()
	return replayHistory(tb, "hm://alice/benchdeep", moves, changesN, true)
}

// replayHistory generates `changesN` signed changes totalling ~`moves` block
// moves, then returns a fresh document with all of them applied — exactly what
// the daemon does when it loads a doc from storage. The accumulated move-op
// log is what State()/Hydrate replays on every read.
func replayHistory(tb testing.TB, iri string, moves int, changesN int, deep bool) *Document {
	tb.Helper()
	alice := coretest.NewTester("alice").Account

	perChange := moves / changesN
	if perChange < 1 {
		perChange = 1
	}

	var history []signedChange
	created := 0
	prev := ""   // last block appended at root (flat case)
	parent := "" // current deepest parent (deep case)

	for c := 0; c < changesN; c++ {
		// Build the next change on a fresh doc that has all prior changes.
		doc := must.Do2(New(blobIRI(iri), cclock.New()))
		for _, sc := range history {
			must.Do(doc.ApplyChange(sc.cid, sc.ch))
		}
		if c == 0 {
			must.Do(doc.SetMetadata("title", "Bench"))
		}
		for i := 0; i < perChange; i++ {
			id := fmt.Sprintf("b%d", created)
			if deep {
				must.Do(doc.MoveBlock(id, parent, ""))
				parent = id
			} else {
				must.Do(doc.MoveBlock(id, "", prev))
				prev = id
			}
			created++
		}
		hb := must.Do2(doc.SignChange(alice))
		history = append(history, signedChange{cid: hb.CID, ch: hb.Decoded})
	}

	// Final doc: replay the entire history, like a cold read from storage.
	doc := must.Do2(New(blobIRI(iri), cclock.New()))
	for _, sc := range history {
		must.Do(doc.ApplyChange(sc.cid, sc.ch))
	}
	return doc
}

// TestHydrateScaling prints hydrate cost as the op-log grows. Run with:
//
//	go test ./backend/api/documents/v3alpha/docmodel/ -run TestHydrateScaling -v
func TestHydrateScaling(t *testing.T) {
	skipUnlessHydrateBench(t)
	ctx := context.Background()
	for _, n := range []int{100, 500, 1000, 2000, 4000} {
		flat := buildDocWithHistory(t, n, n/50+1)
		deep := buildDeepDocWithHistory(t, n, n/50+1)

		start := mustNow()
		_ = must.Do2(flat.Hydrate(ctx))
		flatMs := sinceMs(start)

		start = mustNow()
		_ = must.Do2(deep.Hydrate(ctx))
		deepMs := sinceMs(start)

		t.Logf("moves=%-5d  flatHydrate=%7.2fms  deepHydrate=%7.2fms", n, flatMs, deepMs)
	}
}

func BenchmarkHydrateFlat2000(b *testing.B) {
	ctx := context.Background()
	doc := buildDocWithHistory(b, 2000, 40)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		d, err := doc.Hydrate(ctx)
		require.NoError(b, err)
		require.NotNil(b, d)
	}
}

func BenchmarkHydrateDeep2000(b *testing.B) {
	ctx := context.Background()
	doc := buildDeepDocWithHistory(b, 2000, 40)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		d, err := doc.Hydrate(ctx)
		require.NoError(b, err)
		require.NotNil(b, d)
	}
}

// TestLoadVsHydrate separates the two read-path costs: replaying changes to
// build the CRDT (loadDocument-equivalent) vs Hydrate (State materialization).
func TestLoadVsHydrate(t *testing.T) {
	skipUnlessHydrateBench(t)
	ctx := context.Background()
	alice := coretest.NewTester("alice").Account
	for _, n := range []int{1000, 2000, 4000} {
		// Build history once.
		var history []signedChange
		created, parent := 0, ""
		changesN := n/50 + 1
		perChange := n / changesN
		for c := 0; c < changesN; c++ {
			doc := must.Do2(New(blobIRI("hm://alice/lh"), cclock.New()))
			for _, sc := range history {
				must.Do(doc.ApplyChange(sc.cid, sc.ch))
			}
			for i := 0; i < perChange; i++ {
				id := fmt.Sprintf("b%d", created)
				must.Do(doc.MoveBlock(id, parent, ""))
				parent = id
				created++
			}
			hb := must.Do2(doc.SignChange(alice))
			history = append(history, signedChange{cid: hb.CID, ch: hb.Decoded})
		}
		// Time the replay (load).
		start := mustNow()
		doc := must.Do2(New(blobIRI("hm://alice/lh"), cclock.New()))
		for _, sc := range history {
			must.Do(doc.ApplyChange(sc.cid, sc.ch))
		}
		loadMs := sinceMs(start)
		// Time hydrate.
		start = mustNow()
		_ = must.Do2(doc.Hydrate(ctx))
		hydrateMs := sinceMs(start)
		t.Logf("deep moves=%-5d  load(replay)=%8.2fms  hydrate=%8.2fms  changes=%d", n, loadMs, hydrateMs, changesN)
	}
}

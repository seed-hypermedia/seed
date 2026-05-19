package blob

import (
	"math/rand"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"testing"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type namedBlock struct {
	Name string
	Blob blocks.Block
}

func sampleNamedBlockPermutations(input []namedBlock, n int) [][]namedBlock {
	if n <= 0 {
		return nil
	}

	clone := func(in []namedBlock) []namedBlock {
		out := make([]namedBlock, len(in))
		copy(out, in)
		return out
	}

	key := func(p []namedBlock) string {
		names := make([]string, len(p))
		for i := range p {
			names[i] = p[i].Name
		}
		return strings.Join(names, "+")
	}

	perms := make([][]namedBlock, 0, n)
	seen := make(map[string]struct{}, n)

	add := func(p []namedBlock) {
		k := key(p)
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		perms = append(perms, p)
	}

	// 1) Topological-ish: causal order, ref last.
	add(clone(input))

	// 2) Reverse-topological-ish: ref first, causal chain reversed.
	rev := clone(input)
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	add(rev)

	// 3) Seeded shuffles for stable coverage.
	r := rand.New(rand.NewSource(1))
	for len(perms) < n {
		p := clone(input)
		r.Shuffle(len(p), func(i, j int) {
			p[i], p[j] = p[j], p[i]
		})
		add(p)
	}

	return perms
}

func TestRefVisibilityPropagationSingleRef(t *testing.T) {
	/*
		              cStar
		                │
		                ▼
		c1 ◀── c2 ◀── c4 ◀───┐
		         ▲              │
		         │           Ref (Private)
		         │              │
		       	 c3◀───────────┘
	*/
	alice := coretest.NewTester("alice")
	clock := cclock.New()

	c1, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Genesis")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	c2, err := NewChange(alice.Account, c1.CID, []cid.Cid{c1.CID}, 1, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "First update")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	c3, err := NewChange(alice.Account, c1.CID, []cid.Cid{c2.CID}, 2, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Side branch")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	c4, err := NewChange(alice.Account, c1.CID, []cid.Cid{c2.CID}, 2, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("content", "Merge head")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	cStar, err := NewChange(alice.Account, c1.CID, []cid.Cid{c4.CID}, 3, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("content", "Out of closure")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(alice.Account, 0, c1.CID, alice.Account.Principal(), "/test-doc", []cid.Cid{c4.CID, c3.CID}, clock.MustNow(), VisibilityPrivate)
	require.NoError(t, err)

	input := []namedBlock{
		{"c1", c1},
		{"c2", c2},
		{"c3", c3},
		{"c4", c4},
		{"cStar", cStar},
		{"ref", ref},
	}

	var blobs [][]namedBlock
	// blobs = colx.SlicePermutations(input)
	blobs = sampleNamedBlockPermutations(input, 20)

	for _, test := range blobs {
		order := make([]string, len(test))
		for i, b := range test {
			order[i] = b.Name
		}
		testID := strings.Join(order, "+")
		t.Run(testID, func(t *testing.T) {
			db := storage.MakeTestDB(t)
			idx, err := OpenIndex(t.Context(), db, zap.NewNop())
			require.NoError(t, err)

			toPut := make([]blocks.Block, 0, len(test))
			for _, blob := range test {
				toPut = append(toPut, blob.Blob)
			}
			require.NoError(t, idx.PutMany(t.Context(), toPut))

			if countStashedBlobs(t, db) != 0 {
				t.Fatal("must have no stashed blobs")
			}

			spaceID, err := sqlitex.QueryOnePool[int64](t.Context(), db, "SELECT id FROM public_keys WHERE principal = :principal", alice.Account.Principal())
			require.NoError(t, err)

			visibilityCount := func(t *testing.T, c cid.Cid) int {
				count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COUNT() FROM blob_visibility bv JOIN blobs b ON b.id = bv.id WHERE b.multihash = :multihash AND bv.space = :space", map[string]any{
					":multihash": c.Hash(),
					":space":     spaceID,
				})
				require.NoError(t, err)
				return count
			}

			for _, change := range []struct {
				Name string
				CID  cid.Cid
			}{
				{"c1", c1.CID},
				{"c2", c2.CID},
				{"c3", c3.CID},
				{"c4", c4.CID},
			} {
				require.Equal(t, 1, visibilityCount(t, change.CID), "change %s must inherit private visibility", change.Name)
			}

			require.Equal(t, 0, visibilityCount(t, cStar.CID), "change cStar must not inherit private visibility")
		})
	}
}

// TestPutManyCoalescesPropagation builds a small private-doc graph and asserts
// that the coalesced visibility propagation in PutMany produces the exact same
// blob_visibility state as putting the same blobs one-by-one via Put. Single
// Put preserves the original per-blob propagateVisibility call (no coalesce),
// so this is the apples-to-apples comparison for the optimisation.
func TestPutManyCoalescesPropagation(t *testing.T) {
	build := func() (blocksList []blocks.Block, refCID cid.Cid, signer coretest.Tester) {
		signer = coretest.NewTester("alice")
		clock := cclock.New()

		c1, err := NewChange(signer.Account, cid.Undef, nil, 0, ChangeBody{
			Ops: []OpMap{must.Do2(NewOpSetKey("title", "Genesis"))},
		}, clock.MustNow())
		require.NoError(t, err)

		c2, err := NewChange(signer.Account, c1.CID, []cid.Cid{c1.CID}, 1, ChangeBody{
			Ops: []OpMap{must.Do2(NewOpSetKey("title", "Second"))},
		}, clock.MustNow())
		require.NoError(t, err)

		c3, err := NewChange(signer.Account, c1.CID, []cid.Cid{c2.CID}, 2, ChangeBody{
			Ops: []OpMap{must.Do2(NewOpSetKey("content", "Third"))},
		}, clock.MustNow())
		require.NoError(t, err)

		ref, err := NewRef(signer.Account, 0, c1.CID, signer.Account.Principal(), "/coalesce-test", []cid.Cid{c3.CID}, clock.MustNow(), VisibilityPrivate)
		require.NoError(t, err)

		return []blocks.Block{c1, c2, c3, ref}, ref.CID, signer
	}

	collectVisibility := func(t *testing.T, db *sqlitex.Pool, spaceID int64) map[string]struct{} {
		t.Helper()
		got := make(map[string]struct{})
		require.NoError(t, db.Query(t.Context(), func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn,
				"SELECT lower(hex(b.multihash)) FROM blob_visibility bv JOIN blobs b ON b.id = bv.id WHERE bv.space = :space",
				func(stmt *sqlite.Stmt) error {
					got[stmt.ColumnText(0)] = struct{}{}
					return nil
				}, spaceID)
		}))
		return got
	}

	// Build the blob set ONCE so the two DBs see identical inputs (the clock
	// is stateful so a second build() call would produce different timestamps
	// and therefore different blob CIDs).
	allBlobs, _, alice := build()

	// PutMany path: all blobs go through one batch, the new
	// propagateVisibilityBatch coalesces the recursive CTE walks.
	dbMany := storage.MakeTestDB(t)
	idxMany, err := OpenIndex(t.Context(), dbMany, zap.NewNop())
	require.NoError(t, err)
	require.NoError(t, idxMany.PutMany(t.Context(), allBlobs))
	spaceMany, err := sqlitex.QueryOnePool[int64](t.Context(), dbMany,
		"SELECT id FROM public_keys WHERE principal = :principal", alice.Account.Principal())
	require.NoError(t, err)
	manyVis := collectVisibility(t, dbMany, spaceMany)

	// Put path: one blob at a time. Each Put runs the original per-blob
	// propagateVisibility, no coalesce.
	dbOne := storage.MakeTestDB(t)
	idxOne, err := OpenIndex(t.Context(), dbOne, zap.NewNop())
	require.NoError(t, err)
	for _, blk := range allBlobs {
		require.NoError(t, idxOne.Put(t.Context(), blk))
	}
	spaceOne, err := sqlitex.QueryOnePool[int64](t.Context(), dbOne,
		"SELECT id FROM public_keys WHERE principal = :principal", alice.Account.Principal())
	require.NoError(t, err)
	oneVis := collectVisibility(t, dbOne, spaceOne)

	require.Equal(t, oneVis, manyVis, "coalesced PutMany must produce the same blob_visibility set as sequential Put")
	require.NotEmpty(t, manyVis, "test must actually exercise the propagation path")
}

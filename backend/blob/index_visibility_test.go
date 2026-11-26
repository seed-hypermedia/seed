package blob

import (
	"math/rand"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strconv"
	"strings"
	"testing"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
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

// TestLinkToUnindexedChangeDoesNotLeakVisibility checks that a public blob
// linking to a private Change makes it public in no arrival order. When the
// public blob came first, the link's target was a placeholder typed Raw, which
// matched the Raw visibility rule and made the Change public once it arrived.
func TestLinkToUnindexedChangeDoesNotLeakVisibility(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	clock := cclock.New()

	private, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{must.Do2(NewOpSetKey("title", "Private"))},
	}, clock.MustNow())
	require.NoError(t, err)

	privateRef, err := NewRef(alice.Account, 0, private.CID, alice.Account.Principal(), "/private", []cid.Cid{private.CID}, clock.MustNow(), VisibilityPrivate)
	require.NoError(t, err)

	// A link can name the private change with its own codec, or with the raw
	// codec, which only takes knowing its CID.
	for linkName, link := range map[string]cid.Cid{
		"dag-cbor link": private.CID,
		"raw link":      cid.NewCidV1(cid.Raw, private.CID.Hash()),
	} {
		public, err := NewChange(bob.Account, cid.Undef, nil, 0, ChangeBody{
			Ops: []OpMap{must.Do2(NewOpSetKey("cover", "ipfs://"+link.String()))},
		}, clock.MustNow())
		require.NoError(t, err)

		publicRef, err := NewRef(bob.Account, 0, public.CID, bob.Account.Principal(), "/public", []cid.Cid{public.CID}, clock.MustNow(), VisibilityPublic)
		require.NoError(t, err)

		for name, order := range map[string][]blocks.Block{
			"public first":  {public, publicRef, private, privateRef},
			"private first": {private, privateRef, public, publicRef},
		} {
			for _, batched := range []bool{false, true} {
				t.Run(linkName+"/"+name+map[bool]string{false: "/put", true: "/putmany"}[batched], func(t *testing.T) {
					db := storage.MakeTestDB(t)
					idx, err := OpenIndex(t.Context(), db, zap.NewNop())
					require.NoError(t, err)

					putInOrder(t, idx, order, batched)

					require.Equal(t, 0, countStashedBlobs(t, db))

					aliceID, err := sqlitex.QueryOnePool[int64](t.Context(), db, "SELECT id FROM public_keys WHERE principal = :principal", alice.Account.Principal())
					require.NoError(t, err)

					require.Equal(t, strconv.FormatInt(aliceID, 10), blobSpaces(t, db, private.CID), "the private change must be visible only in its own space")
				})
			}
		}
	}
}

func TestRawMediaTakesVisibilityWhenStored(t *testing.T) {
	bob := coretest.NewTester("bob")
	clock := cclock.New()

	imageData := []byte("image bytes")
	image, err := blocks.NewBlockWithCid(imageData, must.Do2(cid.V1Builder{Codec: cid.Raw, MhType: multihash.SHA2_256}.Sum(imageData)))
	require.NoError(t, err)

	public, err := NewChange(bob.Account, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{must.Do2(NewOpSetKey("cover", "ipfs://"+image.Cid().String()))},
	}, clock.MustNow())
	require.NoError(t, err)

	publicRef, err := NewRef(bob.Account, 0, public.CID, bob.Account.Principal(), "/public", []cid.Cid{public.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	t.Run("no visibility before it's stored", func(t *testing.T) {
		db := storage.MakeTestDB(t)
		idx, err := OpenIndex(t.Context(), db, zap.NewNop())
		require.NoError(t, err)

		putInOrder(t, idx, []blocks.Block{public, publicRef}, false)
		require.Equal(t, "", blobSpaces(t, db, image.Cid()), "a blob we don't have must get no visibility")

		require.NoError(t, idx.Put(t.Context(), image))
		require.Equal(t, "0", blobSpaces(t, db, image.Cid()))
	})

	for name, order := range map[string][]blocks.Block{
		"document first": {public, publicRef, image},
		"media first":    {image, public, publicRef},
	} {
		for _, batched := range []bool{false, true} {
			t.Run(name+map[bool]string{false: "/put", true: "/putmany"}[batched], func(t *testing.T) {
				db := storage.MakeTestDB(t)
				idx, err := OpenIndex(t.Context(), db, zap.NewNop())
				require.NoError(t, err)

				putInOrder(t, idx, order, batched)

				require.Equal(t, "0", blobSpaces(t, db, image.Cid()), "media embedded by a public document must be public")
			})
		}
	}
}

func putInOrder(t *testing.T, idx *Index, order []blocks.Block, batched bool) {
	t.Helper()

	if batched {
		require.NoError(t, idx.PutMany(t.Context(), order))
		return
	}

	for _, b := range order {
		require.NoError(t, idx.Put(t.Context(), b))
	}
}

// blobSpaces returns the spaces a blob is visible in, comma-separated in id order.
func blobSpaces(t *testing.T, db *sqlitex.Pool, c cid.Cid) string {
	t.Helper()

	spaces, err := sqlitex.QueryOnePool[string](t.Context(), db, "SELECT COALESCE(group_concat(space), '') FROM (SELECT bv.space FROM blob_visibility bv JOIN blobs b ON b.id = bv.id WHERE b.multihash = :multihash ORDER BY bv.space)", c.Hash())
	require.NoError(t, err)

	return spaces
}

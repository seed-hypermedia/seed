package rbsr

import (
	"math/rand"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

// foldFingerprint is the ground-truth fingerprint: the exact linear fold the
// production code uses (Add each hash, length left at zero).
func foldFingerprint(items []Item) Fingerprint {
	var acc accumulator
	for _, it := range items {
		acc.Add(it.Hash)
	}
	return acc.Fingerprint()
}

// collectItems returns a sealed store's items in index order.
func collectItems(t *testing.T, s Store) []Item {
	t.Helper()
	out := make([]Item, 0, s.Size())
	require.NoError(t, s.ForEach(0, s.Size(), func(_ int, item Item) bool {
		out = append(out, item)
		return true
	}))
	return out
}

// randomItems builds a deterministic dataset that mixes shared timestamps,
// distinct values, and a few duplicate values (to exercise dedup).
func randomItems(rng *rand.Rand, n int) []Item {
	items := make([]Item, 0, n)
	var ts int64 = 1
	for range n {
		if rng.Intn(8) == 0 {
			ts += int64(rng.Intn(3))
		}
		items = append(items, NewItem(ts, []byte("item-"+strconv.Itoa(rng.Intn(n*2)))))
	}
	return items
}

func insertAll(t *testing.T, s Store, items []Item) {
	t.Helper()
	for _, it := range items {
		require.NoError(t, s.Insert(it.Timestamp, it.Value))
	}
}

// TestTreeStore_Equivalence is the linchpin: a monoid-tree store must be
// observationally identical to the slice store for the same input — same
// ordering, size, lower bounds, and (critically) byte-identical range
// fingerprints across many random ranges.
func TestTreeStore_Equivalence(t *testing.T) {
	rng := rand.New(rand.NewSource(42))

	for range 50 {
		n := rng.Intn(400) + 1
		items := randomItems(rng, n)

		slice := NewSliceStore()
		tree := NewTreeStore()
		insertAll(t, slice, items)
		insertAll(t, tree, items)
		require.NoError(t, slice.Seal())
		require.NoError(t, tree.Seal())

		require.Equal(t, slice.Size(), tree.Size(), "size mismatch")

		sliceItems := collectItems(t, slice)
		treeItems := collectItems(t, tree)
		require.Equal(t, len(sliceItems), len(treeItems))
		for i := range sliceItems {
			require.Equal(t, sliceItems[i].Timestamp, treeItems[i].Timestamp, "ts at %d", i)
			require.Equal(t, sliceItems[i].Value, treeItems[i].Value, "value at %d", i)
		}

		size := tree.Size()
		rf := tree.(RangeFingerprinter)

		// Empty range and full range.
		assertRangeFP(t, rf, sliceItems, 0, 0)
		assertRangeFP(t, rf, sliceItems, 0, size)

		// Many random sub-ranges.
		for range 30 {
			a := rng.Intn(size + 1)
			b := rng.Intn(size + 1)
			if a > b {
				a, b = b, a
			}
			assertRangeFP(t, rf, sliceItems, a, b)
		}

		// FindLowerBound parity against the slice store for random bounds.
		for range 20 {
			bound := sliceItems[rng.Intn(size)]
			startHint := rng.Intn(size + 1)
			want, err := slice.FindLowerBound(startHint, bound)
			require.NoError(t, err)
			got, err := tree.FindLowerBound(startHint, bound)
			require.NoError(t, err)
			require.Equal(t, want, got, "FindLowerBound(startHint=%d) mismatch", startHint)
		}
	}
}

func assertRangeFP(t *testing.T, rf RangeFingerprinter, sorted []Item, start, end int) {
	t.Helper()
	got, err := rf.RangeFingerprint(start, end)
	require.NoError(t, err)
	want := foldFingerprint(sorted[start:end])
	require.Equal(t, want, got, "range [%d,%d)", start, end)
}

// TestTreeStore_IncrementalInsertEquivalence verifies the tree's distinguishing
// feature: inserts after Seal keep it correct, matching a fresh slice store
// built from the full set. This is what lets the index be maintained instead of
// rebuilt.
func TestTreeStore_IncrementalInsertEquivalence(t *testing.T) {
	rng := rand.New(rand.NewSource(7))

	for range 30 {
		base := randomItems(rng, rng.Intn(200)+1)
		extra := randomItems(rng, rng.Intn(200)+1)

		tree := NewTreeStore()
		insertAll(t, tree, base)
		require.NoError(t, tree.Seal())
		// Insert post-seal — disallowed by the slice store, the tree's reason
		// for existing.
		insertAll(t, tree, extra)

		// Ground truth: a fresh slice store with the union of both sets.
		slice := NewSliceStore()
		insertAll(t, slice, base)
		insertAll(t, slice, extra)
		require.NoError(t, slice.Seal())

		require.Equal(t, slice.Size(), tree.Size())

		sliceItems := collectItems(t, slice)
		treeItems := collectItems(t, tree)
		require.Equal(t, len(sliceItems), len(treeItems))
		for i := range sliceItems {
			require.Equal(t, sliceItems[i].Value, treeItems[i].Value, "value at %d", i)
		}

		rf := tree.(RangeFingerprinter)
		size := tree.Size()
		assertRangeFP(t, rf, sliceItems, 0, size)
		for range 20 {
			a := rng.Intn(size + 1)
			b := rng.Intn(size + 1)
			if a > b {
				a, b = b, a
			}
			assertRangeFP(t, rf, sliceItems, a, b)
		}
	}
}

// TestTreeStore_SessionFingerprintParity checks the seam: Session.Fingerprint
// returns the same value whether the store is a slice store (linear fold) or a
// tree store (RangeFingerprinter fast path).
func TestTreeStore_SessionFingerprintParity(t *testing.T) {
	rng := rand.New(rand.NewSource(99))
	items := randomItems(rng, 500)

	slice := NewSliceStore()
	tree := NewTreeStore()
	insertAll(t, slice, items)
	insertAll(t, tree, items)
	require.NoError(t, slice.Seal())
	require.NoError(t, tree.Seal())

	sliceSession, err := NewSession(slice, 50000)
	require.NoError(t, err)
	treeSession, err := NewSession(tree, 50000)
	require.NoError(t, err)

	size := slice.Size()
	for range 100 {
		a := rng.Intn(size + 1)
		b := rng.Intn(size + 1)
		if a > b {
			a, b = b, a
		}
		want, err := sliceSession.Fingerprint(a, b)
		require.NoError(t, err)
		got, err := treeSession.Fingerprint(a, b)
		require.NoError(t, err)
		require.Equal(t, want, got, "Session.Fingerprint range [%d,%d)", a, b)
	}
}

// TestTreeStore_ReplicationParity runs the full RBSR protocol with tree stores
// on both ends and asserts it converges — end-to-end proof the seam is wired
// correctly and produces protocol-compatible output.
func TestTreeStore_ReplicationParity(t *testing.T) {
	dataset := make([]Item, 2000)
	var ts int64 = 1
	for i := range dataset {
		if i%20 == 0 {
			ts++
		}
		dataset[i] = NewItem(ts, []byte("Hello "+strconv.Itoa(i)))
	}

	newTreePeer := func() *peer {
		s := NewTreeStore()
		ne, err := NewSession(s, 50000)
		require.NoError(t, err)
		return &peer{store: s, ne: ne}
	}

	client := newTreePeer()
	server := newTreePeer()
	// Server has everything, client has nothing.
	for _, x := range dataset {
		require.NoError(t, server.store.Insert(x.Timestamp, x.Value))
	}
	require.NoError(t, client.store.Seal())
	require.NoError(t, server.store.Seal())

	msg, err := client.ne.Initiate()
	require.NoError(t, err)

	var allWants [][]byte
	rounds := 0
	for msg != nil {
		rounds++
		require.LessOrEqual(t, rounds, 1000, "too many rounds")
		msg, err = server.ne.Reconcile(msg)
		require.NoError(t, err)
		var haves, wants [][]byte
		msg, err = client.ne.ReconcileWithIDs(msg, &haves, &wants)
		require.NoError(t, err)
		allWants = append(allWants, wants...)
	}

	got := make(map[string]struct{}, len(dataset))
	require.NoError(t, client.store.ForEach(0, client.store.Size(), func(_ int, item Item) bool {
		got[string(item.Value)] = struct{}{}
		return true
	}))
	for _, w := range allWants {
		got[string(w)] = struct{}{}
	}

	want := make(map[string]struct{}, len(dataset))
	for _, item := range dataset {
		want[string(item.Value)] = struct{}{}
	}
	require.Equal(t, want, got, "client must learn the full dataset")
}

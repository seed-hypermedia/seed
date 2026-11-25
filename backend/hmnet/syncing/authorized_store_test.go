package syncing

import (
	"crypto/rand"
	"fmt"
	"sync"
	"testing"

	"seed/backend/core"
	"seed/backend/hmnet/syncing/rbsr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAuthorizedStoreWithFilterConcurrent is the regression test for the data
// race that failed CI on the -race builds: one sealed store is shared by every
// peer goroutine of a sync fan-out (see syncWithManyPeers), and each of them
// calls WithFilter on it. Cloning the visibility map with btree.Map.Copy wrote
// to that shared map, so the clones raced with each other.
//
// It also pins the filtering itself down, so a future rework of the sharing
// can't quietly start leaking private items across peers.
func TestAuthorizedStoreWithFilterConcurrent(t *testing.T) {
	t.Parallel()

	spaceA := generatePrincipal(t)
	spaceB := generatePrincipal(t)

	const itemCount = 60

	// Visibility by item, mirroring what loadRBSRStore builds: every third
	// blob is public, the rest are private to one of the two spaces.
	visibleTo := func(i int, authorized []core.Principal) bool {
		var owner core.Principal
		switch i % 3 {
		case 0:
			return true // Public.
		case 1:
			owner = spaceA
		default:
			owner = spaceB
		}
		for _, sp := range authorized {
			if sp.Equal(owner) {
				return true
			}
		}
		return false
	}

	variants := []struct {
		name       string
		authorized []core.Principal
	}{
		{"unauthorized", nil},
		{"space-a", []core.Principal{spaceA}},
		{"space-b", []core.Principal{spaceB}},
		{"both", []core.Principal{spaceA, spaceB}},
	}

	for _, backend := range []struct {
		name string
		new  func() *authorizedStore
	}{
		{"slice", newAuthorizedStore},
		{"tree", newAuthorizedTreeStore},
	} {
		t.Run(backend.name, func(t *testing.T) {
			t.Parallel()

			store := backend.new()
			for i := range itemCount {
				// Ascending timestamps keep the sealed order equal to the
				// insertion order, so the indices below are deterministic.
				id := fmt.Sprintf("blob-%03d", i)
				require.NoError(t, store.Insert(int64(i+1), []byte(id)))
				switch i % 3 {
				case 1:
					store.SetItemPrivateVisibility(id, spaceA)
				case 2:
					store.SetItemPrivateVisibility(id, spaceB)
				}
			}
			require.NoError(t, store.Seal())
			size := store.Size()
			require.Equal(t, itemCount, size)

			// Expected results, computed sequentially so the fan-out below has
			// something race-free to check itself against.
			type want struct {
				indices []int
				fp      rbsr.Fingerprint
			}
			wants := make([]want, len(variants))
			for i, v := range variants {
				var idx []int
				for j := range itemCount {
					if visibleTo(j, v.authorized) {
						idx = append(idx, j)
					}
				}
				fp, err := store.WithFilter(v.authorized).RangeFingerprint(0, size)
				require.NoError(t, err)
				wants[i] = want{indices: idx, fp: fp}
				require.NotEmpty(t, idx, "%s: every variant must see the public items", v.name)
			}
			require.NotEqual(t, wants[0].fp, wants[3].fp,
				"an unauthorized peer must not get the same fingerprint as a fully authorized one")

			// The store is sealed and frozen from here on, which is exactly the
			// state syncWithManyPeers hands to its peer goroutines.
			const goroutines = 32
			start := make(chan struct{})
			var wg sync.WaitGroup
			for g := range goroutines {
				wg.Add(1)
				go func() {
					defer wg.Done()
					v, w := variants[g%len(variants)], wants[g%len(variants)]

					<-start // Maximize the overlap between the WithFilter calls.
					filtered := store.WithFilter(v.authorized)

					var got []int
					if !assert.NoError(t, filtered.ForEach(0, size, func(i int, _ rbsr.Item) bool {
						got = append(got, i)
						return true
					})) {
						return
					}
					assert.Equal(t, w.indices, got, "%s: peer must see exactly its authorized items", v.name)

					fp, err := filtered.RangeFingerprint(0, size)
					if assert.NoError(t, err) {
						assert.Equal(t, w.fp, fp, "%s: fingerprint must not depend on concurrency", v.name)
					}
				}()
			}
			close(start)
			wg.Wait()
		})
	}
}

func generatePrincipal(t *testing.T) core.Principal {
	t.Helper()
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	return kp.Principal()
}

// TestAuthorizedStoreVisibilityFollowsReorderedItems is the regression test for
// visibility attached by row position. Loaders insert rows in the query's
// order while both backing stores keep items in Item.Compare order, so an
// item's final position is not its insertion index; a position-keyed record
// landed on whichever item ended up there instead. The private item must stay
// hidden from an unauthorized peer whatever order it was inserted in.
func TestAuthorizedStoreVisibilityFollowsReorderedItems(t *testing.T) {
	t.Parallel()

	space := generatePrincipal(t)

	for _, backend := range []struct {
		name string
		new  func() *authorizedStore
	}{
		{"slice", newAuthorizedStore},
		{"tree", newAuthorizedTreeStore},
	} {
		t.Run(backend.name, func(t *testing.T) {
			t.Parallel()

			store := backend.new()
			// Same timestamp, inserted in descending value order: sealing
			// reverses them, so "c" goes in first and ends up last.
			for _, id := range []string{"c", "b", "a"} {
				require.NoError(t, store.Insert(0, []byte(id)))
			}

			store.SetItemPrivateVisibility("c", space)
			require.NoError(t, store.Seal())

			values := func(st *authorizedStore) []string {
				var out []string

				require.NoError(t, st.ForEach(0, st.Size(), func(_ int, item rbsr.Item) bool {
					out = append(out, string(item.Value))
					return true
				}))
				return out
			}
			require.Equal(t, []string{"a", "b"}, values(store.WithFilter(nil)))
			require.Equal(t, []string{"a", "b", "c"}, values(store.WithFilter([]core.Principal{space})))
		})
	}
}

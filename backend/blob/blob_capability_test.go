package blob

import (
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestOutOfOrderCapability(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	change, err := NewChange(bob, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("name", "Hello")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(bob, 0, change.CID, alice.Principal(), "", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	cpb, err := NewCapability(alice, bob.Principal(), alice.Principal(), "", "WRITER", "", clock.MustNow())
	require.NoError(t, err)

	require.NoError(t, idx.Put(t.Context(), ref))
	require.NoError(t, idx.Put(t.Context(), change))
	require.NoError(t, idx.Put(t.Context(), cpb))

	require.Equal(t, 0, countStashedBlobs(t, db), "must have no stashed blobs when ref is indexed before the needed capability")
}

// TestOutOfOrderCapability_FiresIndexedHookForUnstashed guards that the indexed
// hook (which maintains the RBSR index) sees blobs re-indexed by the unstash
// cascade, not just the top-level blob of each Put. A late capability unstashes
// the previously permission-denied ref; without threading the cascade ids to the
// hook, the maintained RBSR index would go stale-short for that ref.
func TestOutOfOrderCapability_FiresIndexedHookForUnstashed(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	var hookIDs []int64
	idx.SetIndexedHook(func(_ *sqlite.Conn, ids []int64) error {
		hookIDs = append(hookIDs, ids...)
		return nil
	})

	clock := cclock.New()
	change, err := NewChange(bob, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("name", "Hello")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(bob, 0, change.CID, alice.Principal(), "", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	cpb, err := NewCapability(alice, bob.Principal(), alice.Principal(), "", "WRITER", "", clock.MustNow())
	require.NoError(t, err)

	// ref arrives before the capability that authorizes bob, so it is stashed.
	require.NoError(t, idx.Put(t.Context(), ref))
	require.NoError(t, idx.Put(t.Context(), change))
	// The capability unstashes ref via the reindex cascade.
	require.NoError(t, idx.Put(t.Context(), cpb))

	require.Equal(t, 0, countStashedBlobs(t, db), "capability must unstash the ref")

	refID := blobIDForCID(t, db, ref.CID)
	require.Contains(t, hookIDs, refID, "indexed hook must fire for the blob unstashed by the capability cascade")
}

func countStashedBlobs(t *testing.T, db *sqlitex.Pool) int {
	count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count() FROM stashed_blobs")
	require.NoError(t, err)
	return count
}

func blobIDForCID(t *testing.T, db *sqlitex.Pool, c cid.Cid) int64 {
	id, err := sqlitex.QueryOnePool[int64](t.Context(), db, "SELECT id FROM blobs WHERE multihash = ?", []byte(c.Hash()))
	require.NoError(t, err)
	return id
}

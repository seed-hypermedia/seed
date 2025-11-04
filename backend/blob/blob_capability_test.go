package blob

import (
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
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

func countStashedBlobs(t *testing.T, db *sqlitex.Pool) int {
	count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count() FROM stashed_blobs")
	require.NoError(t, err)
	return count
}

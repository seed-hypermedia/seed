package blob

import (
	"testing"
	"time"

	"seed/backend/core/coretest"
	"seed/backend/storage"

	"github.com/ipfs/go-cid"
	format "github.com/ipfs/go-ipld-format"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
)

func TestPublicBlockstorePrivateBlobs(t *testing.T) {
	ctx := t.Context()

	pool := storage.MakeTestMemoryDB(t)
	log := zaptest.NewLogger(t)
	idx, err := OpenIndex(ctx, pool, log, nil)
	require.NoError(t, err)

	alice := coretest.NewTester("alice")
	kp := alice.Account
	space := kp.Principal()

	// Create a public comment.
	publicTs := time.Now().Round(ClockPrecision)
	publicComment, err := NewComment(kp, "public-comment", space, "/test", []cid.Cid{}, cid.Undef, cid.Undef, []CommentBlock{
		{Block: Block{Type: "paragraph", Text: "Public comment"}},
	}, VisibilityPublic, publicTs)
	require.NoError(t, err)

	// Create a private comment.
	privateTs := time.Now().Round(ClockPrecision)
	privateComment, err := NewComment(kp, "private-comment", space, "/test", []cid.Cid{}, cid.Undef, cid.Undef, []CommentBlock{
		{Block: Block{Type: "paragraph", Text: "Private comment"}},
	}, VisibilityPrivate, privateTs)
	require.NoError(t, err)

	require.NoError(t, idx.Put(ctx, publicComment))
	require.NoError(t, idx.Put(ctx, privateComment))

	// Get the public blockstore.
	publicBS := &publicBlockstore{idx: idx}

	// Test Has: should return true for public, false for private.
	has, err := publicBS.Has(ctx, publicComment.CID)
	require.NoError(t, err)
	require.True(t, has)

	has, err = publicBS.Has(ctx, privateComment.CID)
	require.NoError(t, err)
	require.False(t, has)

	// Test Get: should return block for public, ErrNotFound for private.
	block, err := publicBS.Get(ctx, publicComment.CID)
	require.NoError(t, err)
	require.NotNil(t, block)

	_, err = publicBS.Get(ctx, privateComment.CID)
	require.ErrorIs(t, err, format.ErrNotFound{Cid: privateComment.CID})

	// Test GetSize: should return size for public, ErrNotFound for private.
	size, err := publicBS.GetSize(ctx, publicComment.CID)
	require.NoError(t, err)
	require.Greater(t, size, 0)

	_, err = publicBS.GetSize(ctx, privateComment.CID)
	require.ErrorIs(t, err, format.ErrNotFound{Cid: privateComment.CID})

	// Test GetMany: public succeeds, private fails.
	publicBlocks, err := publicBS.GetMany(ctx, []cid.Cid{publicComment.CID})
	require.NoError(t, err)
	require.Len(t, publicBlocks, 1)
	require.NotNil(t, publicBlocks[0])

	privateBlocks, err := publicBS.GetMany(ctx, []cid.Cid{privateComment.CID})
	require.Error(t, err)
	require.Nil(t, privateBlocks)

	// Test IterMany: public succeeds, private fails.
	it, _, check := publicBS.IterMany(ctx, []cid.Cid{publicComment.CID}).All()
	var count int
	for range it {
		count++
	}
	require.NoError(t, check())
	require.Equal(t, 1, count)

	it2, _, check2 := publicBS.IterMany(ctx, []cid.Cid{privateComment.CID}).All()
	for range it2 {
		// Consume to trigger error.
		continue
	}
	require.Error(t, check2())

	// Test AllKeysChan: should include public, not private.
	ch, err := publicBS.AllKeysChan(ctx)
	require.NoError(t, err)
	foundPublic := false
	foundPrivate := false
	for c := range ch {
		if c.Equals(publicComment.CID) {
			foundPublic = true
		}
		if c.Equals(privateComment.CID) {
			foundPrivate = true
		}
	}
	require.True(t, foundPublic, "Public blob should be in AllKeysChan")
	require.False(t, foundPrivate, "Private blob should not be in AllKeysChan")
}

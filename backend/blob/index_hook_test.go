package blob

import (
	"errors"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"sync"
	"testing"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestIndexedHook_OffWritePath guards the decoupling of the indexed hook from
// the foreground write path: a Put must commit and return even while the hook
// is stuck, because hook work extending write transactions is what delayed
// comment visibility on busy site daemons.
func TestIndexedHook_OffWritePath(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	block := make(chan struct{})
	var (
		mu  sync.Mutex
		got []int64
	)
	idx.SetIndexedHook(func(_ *sqlite.Conn, ids []int64) error {
		mu.Lock()
		got = append(got, ids...)
		mu.Unlock()
		<-block
		return nil
	})

	clock := cclock.New()
	change, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("name", "Hello")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	done := make(chan error, 1)
	go func() { done <- idx.Put(t.Context(), change) }()
	select {
	case err := <-done:
		require.NoError(t, err, "Put must succeed while the hook is blocked")
	case <-time.After(10 * time.Second):
		t.Fatal("Put must not wait for the indexed hook")
	}

	// The blob must be readable before the hook has finished.
	ok, err := idx.Has(t.Context(), change.CID)
	require.NoError(t, err)
	require.True(t, ok, "blob must be committed before the hook completes")

	close(block)
	require.NoError(t, idx.WaitIndexedHook(t.Context()))

	changeID := blobIDForCID(t, db, change.CID)
	mu.Lock()
	defer mu.Unlock()
	require.Contains(t, got, changeID, "hook must eventually receive the indexed blob")
}

// TestIndexedHook_ErrorDoesNotAffectWrites guards the error policy: a failing
// hook is logged and dropped (shadow-verify repairs the derived index), and
// must neither fail the Put nor wedge the worker for later blobs.
func TestIndexedHook_ErrorDoesNotAffectWrites(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	var (
		mu    sync.Mutex
		calls int
	)
	idx.SetIndexedHook(func(_ *sqlite.Conn, _ []int64) error {
		mu.Lock()
		calls++
		mu.Unlock()
		return errors.New("hook boom")
	})

	clock := cclock.New()
	changeA, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{must.Do2(NewOpSetKey("name", "A"))},
	}, clock.MustNow())
	require.NoError(t, err)
	changeB, err := NewChange(bob, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{must.Do2(NewOpSetKey("name", "B"))},
	}, clock.MustNow())
	require.NoError(t, err)

	require.NoError(t, idx.Put(t.Context(), changeA), "Put must not fail on hook errors")
	require.NoError(t, idx.WaitIndexedHook(t.Context()))
	require.NoError(t, idx.Put(t.Context(), changeB), "worker must keep serving after a hook error")
	require.NoError(t, idx.WaitIndexedHook(t.Context()))

	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, 2, calls, "hook must be attempted for both blobs despite errors")
}

package keylinemem_test

import (
	"context"
	"fmt"
	"testing"
	"testing/synctest"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinemem"
	"seed/backend/keyline/keylinetest"
	"seed/backend/keyline/keylinetest/conformance"

	"github.com/stretchr/testify/require"
)

func newStore(testing.TB) keyline.Store { return &keylinemem.Store{} }

func TestStore(t *testing.T) { keylinetest.Run(t, newStore) }

func TestConformance(t *testing.T) { conformance.Run(t, newStore) }

func FuzzEvaluation(f *testing.F) { conformance.FuzzEvaluation(f, newStore) }

func FuzzStructuredEvaluation(f *testing.F) { conformance.FuzzStructuredEvaluation(f, newStore) }

func BenchmarkEvaluation(b *testing.B) { keylinetest.BenchmarkEvaluation(b, newStore) }

// A writer waiting behind an open View must return on cancellation.
func TestApplyCanceledWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var store keylinemem.Store

		batch := keyline.Batch{Nodes: []keyline.NodeRecord{{"n", 1, 0, "n-blob"}}}
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		done := make(chan error, 1)
		require.NoError(t, store.View(t.Context(), func(keyline.ReadTx) error {
			go func() {
				changed, err := store.Apply(ctx, batch)
				if changed {
					err = fmt.Errorf("blocked update changed state")
				}

				done <- err
			}()
			synctest.Wait()
			require.Empty(t, done)
			cancel()
			synctest.Wait()
			require.Len(t, done, 1, "cancellation must not wait for the writer resource")
			require.ErrorIs(t, <-done, context.Canceled)
			return nil
		}))
		keylinetest.RequireState(t, &store, keyline.Batch{}, batch)
		changed, err := store.Apply(t.Context(), batch)
		require.NoError(t, err)
		require.True(t, changed)
	})
}

func TestMemoryContentionCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var store keylinemem.Store

		batch := keyline.Batch{Nodes: []keyline.NodeRecord{{"doc", 1, 0, "doc-blob"}}}
		writerCtx, cancelWriter := context.WithCancel(t.Context())
		defer cancelWriter()
		readerCtx, cancelReader := context.WithCancel(t.Context())
		defer cancelReader()
		writerDone := make(chan error, 1)
		readerDone := make(chan error, 1)
		require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
			go func() {
				changed, err := store.Apply(writerCtx, batch)
				if changed {
					err = fmt.Errorf("blocked writer committed")
				}

				writerDone <- err
			}()
			synctest.Wait()
			require.Empty(t, writerDone)
			// This reader waits behind the queued writer, despite an active
			// reader holding the lock. A plain RWMutex.RLock cannot cancel.
			go func() {
				readerDone <- store.View(readerCtx, func(keyline.ReadTx) error {
					return fmt.Errorf("canceled reader callback ran")
				})
			}()
			synctest.Wait()
			require.Empty(t, readerDone)
			cancelReader()
			synctest.Wait()
			require.Len(t, readerDone, 1, "reader must cancel while the lock remains held")
			require.ErrorIs(t, <-readerDone, context.Canceled)

			// Canceling the head writer must wake another queued reader
			// without requiring the original reader to release its lock.
			go func() { readerDone <- store.View(t.Context(), func(keyline.ReadTx) error { return nil }) }()
			synctest.Wait()
			require.Empty(t, readerDone)
			cancelWriter()
			synctest.Wait()
			require.Len(t, writerDone, 1, "writer must cancel while the lock remains held")
			require.ErrorIs(t, <-writerDone, context.Canceled)
			require.Len(t, readerDone, 1, "concurrent readers must be admitted after writer cancellation")
			require.NoError(t, <-readerDone)
			return nil
		}))
		keylinetest.RequireState(t, &store, keyline.Batch{}, batch)
		changed, err := store.Apply(t.Context(), batch)
		require.NoError(t, err)
		require.True(t, changed)
		keylinetest.RequireState(t, &store, batch, keyline.Batch{})
	})
}

func TestMemoryReadVisibility(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var store keylinemem.Store

		batch := keyline.Batch{
			Nodes:       []keyline.NodeRecord{{"doc", 1, 0, "doc-blob"}},
			Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 2}},
			Revocations: []keyline.Revocation{{"r", "alice", "missing", 3}},
		}
		done := make(chan error, 1)
		require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
			go func() {
				changed, err := store.Apply(t.Context(), batch)
				if err == nil && !changed {
					err = fmt.Errorf("fresh batch reported no change")
				}

				done <- err
			}()
			synctest.Wait()
			require.Empty(t, done)
			_, found, err := tx.Node(t.Context(), "doc")
			require.NoError(t, err)
			require.False(t, found)
			_, found, err = tx.Delegation(t.Context(), "d")
			require.NoError(t, err)
			require.False(t, found)
			_, found, err = tx.Revocation(t.Context(), "r")
			require.NoError(t, err)
			require.False(t, found)
			return nil
		}))
		require.NoError(t, <-done)
		keylinetest.RequireState(t, &store, batch, keyline.Batch{})
	})
}

func TestMemoryCanceledReadMethods(t *testing.T) {
	var store keylinemem.Store

	batch := keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"doc", 1, 0, "doc-blob"}},
		Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r", "alice", "d", 3}},
	}
	_, err := store.Apply(t.Context(), batch)
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		for _, id := range []string{"doc", "d", "r", "missing"} {
			n, found, err := tx.Node(ctx, keyline.Node(id))
			require.ErrorIs(t, err, context.Canceled)
			require.False(t, found)
			require.Zero(t, n)
			d, found, err := tx.Delegation(ctx, keyline.ID(id))
			require.ErrorIs(t, err, context.Canceled)
			require.False(t, found)
			require.Zero(t, d)
			r, found, err := tx.Revocation(ctx, keyline.ID(id))
			require.ErrorIs(t, err, context.Canceled)
			require.False(t, found)
			require.Zero(t, r)
			count := 0
			for d, err := range tx.Delegations(ctx, keyline.Node(id), keyline.Node(id)) {
				require.ErrorIs(t, err, context.Canceled)
				require.Zero(t, d)
				count++
			}

			require.Equal(t, 1, count)
			count = 0
			for r, err := range tx.Revocations(ctx, keyline.ID(id)) {
				require.ErrorIs(t, err, context.Canceled)
				require.Zero(t, r)
				count++
			}

			require.Equal(t, 1, count)
		}

		return nil
	}))
}

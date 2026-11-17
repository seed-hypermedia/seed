//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"iter"
	"math"
	"slices"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

func enumerationBatch() keyline.Batch {
	return keyline.Batch{
		Nodes: []keyline.NodeRecord{
			{"shared", math.MaxInt64, 0, "shared-blob"}, {"\xff", 1, 0, "\xff"}, {"prefix\x00tail", 9, 0, "prefix\x00tail"},
			{"prefix", 2, 0, "prefix"}, {"\x00", 3, 0, "\x00"}, {" Standalone ", 4, 0, " Standalone "}, {"node-only", 6, 0, "node-only"},
		},
		Delegations: []keyline.Delegation{
			{"shared", "doc", "alice", "doc", keyline.Read, 7},
			{"\xff\x00", "unknown issuer", "alice", "doc", keyline.Admin, math.MaxInt64},
			{"a\x00", "doc", "bob", "doc", keyline.Write, 7},
			{"A", "unknown issuer", "alice", "doc\x00", keyline.Sync, 11},
			{"\x00", "unknown issuer", "\xff", " doc", keyline.Read, 12},
			{"\xfe", "unknown issuer", "alice", "\xff", keyline.Read, 13},
			{"z", "unknown issuer", "alice", "\x00", keyline.Write, 14},
			{"a", "unknown issuer", "alice", "prefix\x00tail", keyline.Read, 15},
			{"prefix", "unknown issuer", "alice", "prefix", keyline.Read, 16},
			{"a ", "unknown issuer", "alice", "doc", keyline.Sync, 17},
		},
		Revocations: []keyline.Revocation{
			{"r", "alice", "shared", 18},
			{"\xfe\x00", "unknown revoker", "unknown target", 19},
			{"B", "unknown revoker", "r", 20},
			{"r\x00", "unknown revoker", "unknown target", 21},
		},
	}
}

// upstream: scenarios::delegations_to_lists_dead_delegations_too
func testEnumeration(t *testing.T, newStore NewStore) {
	t.Run("contents", func(t *testing.T) {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprint(reverse), func(t *testing.T) {
				store := newStore(t)
				ctx := t.Context()

				batch := enumerationBatch()
				if reverse {
					slices.Reverse(batch.Nodes)
					slices.Reverse(batch.Delegations)
					slices.Reverse(batch.Revocations)
				}

				// Unknown targets arrive first; references never create node records.
				for _, part := range []keyline.Batch{{Revocations: batch.Revocations}, {Delegations: batch.Delegations}, {Nodes: batch.Nodes}} {
					changed, err := store.Apply(ctx, part)
					require.NoError(t, err)
					require.True(t, changed)
				}

				changed, err := store.Apply(ctx, batch)
				require.NoError(t, err)
				require.False(t, changed)
				slices.SortFunc(batch.Nodes, func(a, b keyline.NodeRecord) int { return cmp.Compare(a.ID, b.ID) })
				slices.SortFunc(batch.Delegations, func(a, b keyline.Delegation) int { return cmp.Compare(a.ID, b.ID) })
				slices.SortFunc(batch.Revocations, func(a, b keyline.Revocation) int { return cmp.Compare(a.ID, b.ID) })
				var want []keyline.Record

				for _, n := range batch.Nodes {
					want = append(want, n)
				}

				for _, d := range batch.Delegations {
					want = append(want, d)
				}

				for _, r := range batch.Revocations {
					want = append(want, r)
				}

				require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
					require.Equal(t, want, collectEnumeration(t, tx.Records(ctx)), "kind order, opaque IDs, and exact provenance")
					subjects := []keyline.Node{"\x00", " doc", "doc", "doc\x00", "prefix", "prefix\x00tail", "\xff"}
					require.Equal(t, subjects, collectEnumeration(t, tx.Subjects(ctx)))
					for _, subject := range append(subjects, "", "missing", "node-only", "unknown issuer", "Doc") {
						var bySubject []keyline.Delegation

						for _, d := range batch.Delegations {
							if d.Subject == subject {
								bySubject = append(bySubject, d)
							}
						}

						require.ElementsMatch(t, bySubject, collectEnumeration(t, tx.DelegationsBySubject(ctx, subject)))
						for _, audience := range []keyline.Node{"alice", "bob", "\xff", "", "missing", "Alice"} {
							var toAudience []keyline.Delegation

							for _, d := range bySubject {
								if d.Audience == audience {
									toAudience = append(toAudience, d)
								}
							}

							require.ElementsMatch(t, toAudience, collectEnumeration(t, tx.DelegationsTo(ctx, subject, audience)))
						}
					}

					for _, id := range []keyline.Node{"doc", "alice", "unknown issuer", "unknown revoker", "unknown target"} {
						_, found, err := tx.Node(ctx, id)
						require.NoError(t, err)
						require.False(t, found)
					}

					return nil
				}))
			})
		}
	})

	t.Run("atomic indexes", func(t *testing.T) {
		store := newStore(t)
		ctx := t.Context()
		base := keyline.Delegation{"base", "doc", "alice", "doc", keyline.Read, 1}
		fresh := keyline.Delegation{"fresh", "other", "alice", "other", keyline.Write, 2}
		_, err := store.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{base}})
		require.NoError(t, err)
		conflict := base
		conflict.BlobID++
		changed, err := store.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{fresh, conflict}})
		require.ErrorIs(t, err, keyline.ErrConflict)
		require.False(t, changed)
		require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
			require.Equal(t, []keyline.Record{base}, collectEnumeration(t, tx.Records(ctx)))
			require.Equal(t, []keyline.Node{"doc"}, collectEnumeration(t, tx.Subjects(ctx)))
			require.Empty(t, collectEnumeration(t, tx.DelegationsBySubject(ctx, "other")))
			require.Empty(t, collectEnumeration(t, tx.DelegationsTo(ctx, "other", "alice")))
			return nil
		}))
		changed, err = store.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{fresh, fresh, base}})
		require.NoError(t, err)
		require.True(t, changed)
		require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
			require.Equal(t, []keyline.Record{base, fresh}, collectEnumeration(t, tx.Records(ctx)))
			require.Equal(t, []keyline.Node{"doc", "other"}, collectEnumeration(t, tx.Subjects(ctx)))
			require.Equal(t, []keyline.Delegation{fresh}, collectEnumeration(t, tx.DelegationsBySubject(ctx, "other")))
			require.Equal(t, []keyline.Delegation{fresh}, collectEnumeration(t, tx.DelegationsTo(ctx, "other", "alice")))
			return nil
		}))
	})

	for _, populated := range []bool{false, true} {
		t.Run(fmt.Sprintf("lifecycle/populated=%v", populated), func(t *testing.T) {
			store := newStore(t)

			ctx := t.Context()
			if populated {
				_, err := store.Apply(ctx, enumerationBatch())
				require.NoError(t, err)
			}

			require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
				t.Run("subjects", func(t *testing.T) { testEnumerationLifecycle(t, tx, tx.Subjects) })
				t.Run("records", func(t *testing.T) { testEnumerationLifecycle(t, tx, tx.Records) })
				t.Run("by subject", func(t *testing.T) {
					testEnumerationLifecycle(t, tx, func(ctx context.Context) iter.Seq2[keyline.Delegation, error] {
						return tx.DelegationsBySubject(ctx, "doc")
					})
				})
				t.Run("to audience", func(t *testing.T) {
					testEnumerationLifecycle(t, tx, func(ctx context.Context) iter.Seq2[keyline.Delegation, error] {
						return tx.DelegationsTo(ctx, "doc", "alice")
					})
				})
				return nil
			}))

			if populated {
				failure := errors.New("reader stopped")
				require.ErrorIs(t, store.View(ctx, func(tx keyline.ReadTx) error {
					for _, err := range tx.Records(ctx) {
						require.NoError(t, err)
						return failure
					}

					return nil
				}), failure)
				require.Panics(t, func() {
					_ = store.View(ctx, func(tx keyline.ReadTx) error {
						for _, err := range tx.Records(ctx) {
							require.NoError(t, err)
							panic("reader panic")
						}

						return nil
					})
				})
				changed, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"after panic", 99, 0, "after-panic-blob"}}})
				require.NoError(t, err, "failed readers must release the store")
				require.True(t, changed)
			}
		})
	}
}

func collectEnumeration[T any](t *testing.T, rows iter.Seq2[T, error]) []T {
	t.Helper()
	var result []T

	for value, err := range rows {
		require.NoError(t, err)
		result = append(result, value)
	}

	return result
}

func testEnumerationLifecycle[T any](t *testing.T, tx keyline.ReadTx, query func(context.Context) iter.Seq2[T, error]) {
	t.Helper()
	ctx := t.Context()
	want := collectEnumeration(t, query(ctx))
	queryCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	rows := query(queryCtx)
	// Creating an iterator must neither open a cursor nor consume its context.
	_, _, err := tx.Node(ctx, "probe")
	require.NoError(t, err)
	cancel()
	failures := 0
	for value, err := range rows {
		require.Zero(t, value)
		require.ErrorIs(t, err, context.Canceled)
		failures++
	}

	require.Equal(t, 1, failures, "even empty iterators report cancellation exactly once")
	require.ElementsMatch(t, want, collectEnumeration(t, query(ctx)))

	// Exercise every position, including Records' transitions between SQL cursors.
	for stopAfter := 1; stopAfter <= len(want); stopAfter++ {
		for _, mode := range []string{"break", "panic", "cancel", "cancel and break"} {
			queryCtx, cancel := context.WithCancel(ctx)
			count, failures := 0, 0

			run := func() {
				for value, err := range query(queryCtx) {
					if err != nil {
						require.Zero(t, value)
						require.ErrorIs(t, err, context.Canceled)
						failures++
						continue // The iterator, not the consumer, must stop after error.
					}

					count++
					if count == stopAfter {
						switch mode {
						case "break":
							return
						case "panic":
							panic("consumer panic")
						case "cancel":
							cancel()
						case "cancel and break":
							cancel()
							return
						}
					}
				}
			}
			if mode == "panic" {
				require.Panics(t, run)
			} else {
				run()
			}

			cancel()
			require.Equal(t, stopAfter, count, mode)

			if mode == "cancel" {
				require.Equal(t, 1, failures)
			} else {
				require.Zero(t, failures)
			}

			_, _, err := tx.Node(ctx, "probe")
			require.NoError(t, err)
			require.ElementsMatch(t, want, collectEnumeration(t, query(ctx)), "reuse after "+mode)
		}
	}
}

//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"context"
	"math"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// testBatchContract checks public lookups and indexes, not implementation state,
// with a fresh store for each subtest.
func testBatchContract(t *testing.T, newStore NewStore) {
	t.Run("provenance replay", func(t *testing.T) {
		store := newStore(t)
		ctx := t.Context()
		base := keyline.Batch{
			Nodes:       []keyline.NodeRecord{{"a", 100, 0, "shared-blob"}, {"r", 100, 0, "shared-blob"}},
			Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Read, math.MaxInt64}},
			Revocations: []keyline.Revocation{{"r", "alice", "missing", 100}},
		}
		assertBatchState(t, store, keyline.Batch{}, base)
		changed, err := store.Apply(ctx, keyline.Batch{})
		require.NoError(t, err)
		require.False(t, changed)
		assertBatchState(t, store, keyline.Batch{}, base)

		// Node IDs can equal either kind of fact ID. One blob may define several
		// records; its numeric value has no ordering or authority semantics.
		duplicates := keyline.Batch{
			Nodes:       append(append([]keyline.NodeRecord{}, base.Nodes...), base.Nodes...),
			Delegations: []keyline.Delegation{base.Delegations[0], base.Delegations[0]},
			Revocations: []keyline.Revocation{base.Revocations[0], base.Revocations[0]},
		}
		changed, err = store.Apply(ctx, duplicates)
		require.NoError(t, err)
		require.True(t, changed)
		assertBatchState(t, store, base, keyline.Batch{Nodes: []keyline.NodeRecord{{ID: "doc"}, {ID: "alice"}}})
		q := testQueries{t, store}
		require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"), "node records are not required for authority")

		changed, err = store.Apply(ctx, duplicates)
		require.NoError(t, err)
		require.False(t, changed)
		assertBatchState(t, store, base, keyline.Batch{})

		later := keyline.Batch{
			Nodes:       []keyline.NodeRecord{{"doc", 7, 0, "doc-blob"}},
			Delegations: []keyline.Delegation{base.Delegations[0]},
			Revocations: []keyline.Revocation{{"stop", "alice", "a", 8}},
		}
		changed, err = store.Apply(ctx, later)
		require.NoError(t, err)
		require.True(t, changed)
		base.Nodes = append(base.Nodes, later.Nodes...)
		base.Revocations = append(base.Revocations, later.Revocations...)
		assertBatchState(t, store, base, keyline.Batch{})
		require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))

		// Ingestion copies values; retaining or editing the input slices must
		// not change records or their indexes after Apply returns.
		duplicates.Nodes[0].BlobID++
		duplicates.Delegations[0].Audience = "mallory"
		duplicates.Revocations[0].Target = "a"
		assertBatchState(t, store, base, keyline.Batch{})
	})

	base := keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"old-n", 1, 0, "old-blob"}},
		Delegations: []keyline.Delegation{{"old-d", "doc", "alice", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"old-r", "alice", "missing", 3}},
	}
	for _, tt := range []struct {
		name     string
		tail     keyline.Batch
		conflict bool
	}{
		{"existing node provenance", keyline.Batch{Nodes: []keyline.NodeRecord{{"old-n", 9, 0, "old-blob"}}}, true},
		{"existing delegation provenance", keyline.Batch{Delegations: []keyline.Delegation{{"old-d", "doc", "alice", "doc", keyline.Read, 9}}}, true},
		{"existing delegation contents", keyline.Batch{Delegations: []keyline.Delegation{{"old-d", "doc", "alice", "doc", keyline.Admin, 2}}}, true},
		{"existing revocation provenance", keyline.Batch{Revocations: []keyline.Revocation{{"old-r", "alice", "missing", 9}}}, true},
		{"existing revocation contents", keyline.Batch{Revocations: []keyline.Revocation{{"old-r", "bob", "missing", 3}}}, true},
		{"delegation reuses revocation ID", keyline.Batch{Delegations: []keyline.Delegation{{"old-r", "doc", "alice", "doc", keyline.Read, 9}}}, true},
		{"revocation reuses delegation ID", keyline.Batch{Revocations: []keyline.Revocation{{"old-d", "alice", "missing", 9}}}, true},
		{"batch node provenance", keyline.Batch{Nodes: []keyline.NodeRecord{{"new-n", 9, 0, "new-blob"}}}, true},
		{"batch delegation provenance", keyline.Batch{Delegations: []keyline.Delegation{{"new-d", "doc", "bob", "doc", keyline.Write, 9}}}, true},
		{"batch delegation contents", keyline.Batch{Delegations: []keyline.Delegation{{"new-d", "doc", "bob", "doc", keyline.Admin, 5}}}, true},
		{"batch revocation provenance", keyline.Batch{Revocations: []keyline.Revocation{{"new-r", "bob", "missing", 9}}}, true},
		{"batch revocation contents", keyline.Batch{Revocations: []keyline.Revocation{{"new-r", "carol", "missing", 6}}}, true},
		{"batch cross kind ID", keyline.Batch{Revocations: []keyline.Revocation{{"new-d", "bob", "missing", 9}}}, true},
		{"empty node ID", keyline.Batch{Nodes: []keyline.NodeRecord{{"", 9, 0, "blob"}}}, false},
		{"zero node blob", keyline.Batch{Nodes: []keyline.NodeRecord{{"bad", 0, 0, "blob"}}}, false},
		{"negative node blob", keyline.Batch{Nodes: []keyline.NodeRecord{{"bad", -1, 0, "blob"}}}, false},
		{"empty node blob key", keyline.Batch{Nodes: []keyline.NodeRecord{{"bad", 9, 0, ""}}}, false},
		{"zero delegation blob", keyline.Batch{Delegations: []keyline.Delegation{{"bad", "doc", "bob", "doc", keyline.Write, 0}}}, false},
		{"negative delegation blob", keyline.Batch{Delegations: []keyline.Delegation{{"bad", "doc", "bob", "doc", keyline.Write, -1}}}, false},
		{"zero revocation blob", keyline.Batch{Revocations: []keyline.Revocation{{"bad", "bob", "missing", 0}}}, false},
		{"negative revocation blob", keyline.Batch{Revocations: []keyline.Revocation{{"bad", "bob", "missing", -1}}}, false},
		{"invalid final revocation", keyline.Batch{Revocations: []keyline.Revocation{{"bad", "bob", "", 9}}}, false},
	} {
		t.Run("rollback/"+tt.name, func(t *testing.T) {
			store := newStore(t)
			changed, err := store.Apply(t.Context(), base)
			require.NoError(t, err)
			require.True(t, changed)
			fresh := keyline.Batch{
				Nodes:       []keyline.NodeRecord{{"new-n", 4, 0, "new-blob"}},
				Delegations: []keyline.Delegation{{"new-d", "doc", "bob", "doc", keyline.Write, 5}},
				Revocations: []keyline.Revocation{{"new-r", "bob", "missing", 6}},
			}
			batch := keyline.Batch{
				Nodes:       append(append([]keyline.NodeRecord{}, fresh.Nodes...), tt.tail.Nodes...),
				Delegations: append(append([]keyline.Delegation{}, fresh.Delegations...), tt.tail.Delegations...),
				Revocations: append(append([]keyline.Revocation{}, fresh.Revocations...), tt.tail.Revocations...),
			}
			changed, err = store.Apply(t.Context(), batch)
			require.Error(t, err)
			require.False(t, changed)

			if tt.conflict {
				require.ErrorIs(t, err, keyline.ErrConflict)
			}

			assertBatchState(t, store, base, fresh)
			// A failed batch must release its write resources and reserve no IDs.
			changed, err = store.Apply(t.Context(), fresh)
			require.NoError(t, err)
			require.True(t, changed)
			assertBatchState(t, store, keyline.Batch{
				Nodes:       append(append([]keyline.NodeRecord{}, base.Nodes...), fresh.Nodes...),
				Delegations: append(append([]keyline.Delegation{}, base.Delegations...), fresh.Delegations...),
				Revocations: append(append([]keyline.Revocation{}, base.Revocations...), fresh.Revocations...),
			}, keyline.Batch{})
		})
	}

	t.Run("canceled apply", func(t *testing.T) {
		store := newStore(t)
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		for _, batch := range []keyline.Batch{{}, base} {
			changed, err := store.Apply(ctx, batch)
			require.ErrorIs(t, err, context.Canceled)
			require.False(t, changed)
			assertBatchState(t, store, keyline.Batch{}, base)
		}
	})
}

// assertBatchState checks all supplied IDs and both indexes in a single view.
// The absent batch supplies IDs and index keys that must remain empty on rollback.
func assertBatchState(t *testing.T, store keyline.Store, present, absent keyline.Batch) {
	t.Helper()
	ctx := t.Context()
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		outgoing := map[[2]keyline.Node][]keyline.Delegation{}
		targeting := map[keyline.ID][]keyline.Revocation{}
		for _, n := range present.Nodes {
			got, found, err := tx.Node(ctx, n.ID)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, n, got)
		}

		for _, d := range present.Delegations {
			got, found, err := tx.Delegation(ctx, d.ID)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, d, got)
			key := [2]keyline.Node{d.Subject, d.Issuer}
			outgoing[key] = append(outgoing[key], d)
		}

		for _, r := range present.Revocations {
			got, found, err := tx.Revocation(ctx, r.ID)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, r, got)
			targeting[r.Target] = append(targeting[r.Target], r)
		}

		for _, n := range absent.Nodes {
			got, found, err := tx.Node(ctx, n.ID)
			require.NoError(t, err)
			require.False(t, found)
			require.Zero(t, got)
		}

		for _, d := range absent.Delegations {
			got, found, err := tx.Delegation(ctx, d.ID)
			require.NoError(t, err)
			require.False(t, found)
			require.Zero(t, got)

			key := [2]keyline.Node{d.Subject, d.Issuer}
			if _, ok := outgoing[key]; !ok {
				outgoing[key] = nil
			}
		}

		for _, r := range absent.Revocations {
			got, found, err := tx.Revocation(ctx, r.ID)
			require.NoError(t, err)
			require.False(t, found)
			require.Zero(t, got)

			if _, ok := targeting[r.Target]; !ok {
				targeting[r.Target] = nil
			}
		}

		for key, want := range outgoing {
			var got []keyline.Delegation

			for d, err := range tx.Delegations(ctx, key[0], key[1]) {
				require.NoError(t, err)
				got = append(got, d)
			}

			require.ElementsMatch(t, want, got)
		}

		for target, want := range targeting {
			var got []keyline.Revocation

			for r, err := range tx.Revocations(ctx, target) {
				require.NoError(t, err)
				got = append(got, r)
			}

			require.ElementsMatch(t, want, got)
		}

		return nil
	}))
}

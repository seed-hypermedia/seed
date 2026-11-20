//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"context"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

func testApply(t *testing.T, newStore NewStore) {
	base := keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"old-n", 1, 0, "old-blob"}},
		Delegations: []keyline.Delegation{{"old-d", "doc", "alice", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"old-r", "alice", "missing", 3}},
	}
	fresh := keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"new-n", 4, 0, "new-blob"}},
		Delegations: []keyline.Delegation{{"new-d", "other", "bob", "other", keyline.Write, 5}},
		Revocations: []keyline.Revocation{{"new-r", "alice", "old-d", 6}},
	}
	t.Run("apply and replay", func(t *testing.T) {
		store := newStore(t)
		ctx := t.Context()
		changed, err := store.Apply(ctx, keyline.Batch{})
		require.NoError(t, err)
		require.False(t, changed)
		RequireState(t, store, keyline.Batch{}, base)
		changed, err = store.Apply(ctx, base)
		require.NoError(t, err)
		require.True(t, changed)
		RequireState(t, store, base, fresh)
		for _, batch := range []keyline.Batch{{}, base} {
			changed, err := store.Apply(ctx, batch)
			require.NoError(t, err)
			require.False(t, changed)
			RequireState(t, store, base, fresh)
		}

		changed, err = store.Apply(ctx, fresh)
		require.NoError(t, err)
		require.True(t, changed)
		want := keyline.Batch{
			Nodes:       append(base.Nodes, fresh.Nodes...),
			Delegations: append(base.Delegations, fresh.Delegations...),
			Revocations: append(base.Revocations, fresh.Revocations...),
		}
		RequireState(t, store, want, keyline.Batch{})
		changed, err = store.Apply(ctx, want)
		require.NoError(t, err)
		require.False(t, changed)
		RequireState(t, store, want, keyline.Batch{})
	})
	t.Run("validation rollback", func(t *testing.T) {
		store := newStore(t)
		_, err := store.Apply(t.Context(), base)
		require.NoError(t, err)
		for _, tail := range []keyline.Revocation{{"bad", "alice", "", 7}, {"old-d", "alice", "missing", 7}} {
			batch := fresh
			batch.Revocations = append(append([]keyline.Revocation{}, fresh.Revocations...), tail)
			changed, err := store.Apply(t.Context(), batch)
			require.Error(t, err)
			require.False(t, changed)
			RequireState(t, store, base, fresh)
		}
	})
	t.Run("canceled", func(t *testing.T) {
		store := newStore(t)
		_, err := store.Apply(t.Context(), base)
		require.NoError(t, err)
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		for _, batch := range []keyline.Batch{{}, base, fresh} {
			changed, err := store.Apply(ctx, batch)
			require.ErrorIs(t, err, context.Canceled)
			require.False(t, changed)
			RequireState(t, store, base, fresh)
		}
	})
}

// RequireState requires store to hold exactly the records in present, through
// every lookup, index, and enumeration, and none of the IDs or index keys in absent.
func RequireState(t *testing.T, store keyline.Store, present, absent keyline.Batch) {
	t.Helper()
	assertBatchState(t, store, present, absent)
	ctx := t.Context()
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		var records []keyline.Record

		bySubject := map[keyline.Node][]keyline.Delegation{}
		toAudience := map[[2]keyline.Node][]keyline.Delegation{}
		for _, n := range present.Nodes {
			records = append(records, n)
		}

		for _, d := range present.Delegations {
			records = append(records, d)
			bySubject[d.Subject] = append(bySubject[d.Subject], d)
			key := [2]keyline.Node{d.Subject, d.Audience}
			toAudience[key] = append(toAudience[key], d)
		}

		for _, r := range present.Revocations {
			records = append(records, r)
		}

		var subjects []keyline.Node

		for subject := range bySubject {
			subjects = append(subjects, subject)
		}

		require.ElementsMatch(t, records, collectEnumeration(t, tx.Records(ctx)))
		require.ElementsMatch(t, subjects, collectEnumeration(t, tx.Subjects(ctx)))
		for _, d := range absent.Delegations {
			if _, ok := bySubject[d.Subject]; !ok {
				bySubject[d.Subject] = nil
			}

			key := [2]keyline.Node{d.Subject, d.Audience}
			if _, ok := toAudience[key]; !ok {
				toAudience[key] = nil
			}
		}

		for subject, want := range bySubject {
			require.ElementsMatch(t, want, collectEnumeration(t, tx.DelegationsBySubject(ctx, subject)))
		}

		for key, want := range toAudience {
			require.ElementsMatch(t, want, collectEnumeration(t, tx.DelegationsTo(ctx, key[0], key[1])))
		}

		return nil
	}))
}

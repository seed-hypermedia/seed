//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

func testReadTransactions(t *testing.T, newStore NewStore) {
	facts := testFacts{
		Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Write, 1}, {"b", "doc", "bob", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r1", "alice", "a", 3}, {"r2", "bob", "a", 4}},
	}
	store := facts.store(t, newStore)
	ctx := t.Context()
	errStop := errors.New("stop iteration")
	require.ErrorIs(t, store.View(ctx, func(tx keyline.ReadTx) error {
		count := 0
		for _, err := range tx.Delegations(ctx, "doc", "doc") {
			require.NoError(t, err)
			count++
			break
		}

		require.Equal(t, 1, count)
		count = 0
		for _, err := range tx.Revocations(ctx, "a") {
			require.NoError(t, err)
			count++
			break
		}

		require.Equal(t, 1, count)
		// Reuse the same SQL statements within this transaction: break
		// must already have released both cursors.
		count = 0
		for _, err := range tx.Delegations(ctx, "doc", "doc") {
			require.NoError(t, err)
			count++
		}

		require.Equal(t, 2, count)
		count = 0
		for _, err := range tx.Revocations(ctx, "a") {
			require.NoError(t, err)
			count++
		}

		require.Equal(t, 2, count)
		return errStop
	}), errStop)
	q := testQueries{t, store}
	require.True(t, q.Allows("doc", "bob", keyline.Read), "failed readers must release resources")
	require.Panics(t, func() {
		_ = store.View(ctx, func(tx keyline.ReadTx) error {
			for _, err := range tx.Delegations(ctx, "doc", "doc") {
				require.NoError(t, err)
				panic("reader panic")
			}

			return nil
		})
	})
	require.True(t, q.Allows("doc", "bob", keyline.Read), "panicking readers must release resources")

	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.ErrorIs(t, store.View(canceled, func(keyline.ReadTx) error {
		t.Fatal("canceled transaction must not run")
		return nil
	}), context.Canceled)
}

// Faults after yielding real rows exercise incomplete reads, not just failures
// before the first fact. A truncated revocation stream must never grant access.
type failingReadTx struct {
	keyline.ReadTx
	stage string
	err   error
}

func (tx failingReadTx) Delegation(ctx context.Context, id keyline.ID) (keyline.Delegation, bool, error) {
	d, found, err := tx.ReadTx.Delegation(ctx, id)
	if tx.stage == "delegation" {
		return d, found, tx.err
	}

	return d, found, err
}

func (tx failingReadTx) Delegations(ctx context.Context, subject, issuer keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return func(yield func(keyline.Delegation, error) bool) {
		for d, err := range tx.ReadTx.Delegations(ctx, subject, issuer) {
			if !yield(d, err) || err != nil {
				return
			}
		}

		if tx.stage == "delegations" {
			yield(keyline.Delegation{}, tx.err)
		}
	}
}

// DelegationsBySubject is the evaluator's delegation read, so it fails at the
// same stage as Delegations.
func (tx failingReadTx) DelegationsBySubject(ctx context.Context, subject keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return func(yield func(keyline.Delegation, error) bool) {
		for d, err := range tx.ReadTx.DelegationsBySubject(ctx, subject) {
			if !yield(d, err) || err != nil {
				return
			}
		}

		if tx.stage == "delegations" {
			yield(keyline.Delegation{}, tx.err)
		}
	}
}

func (tx failingReadTx) Revocations(ctx context.Context, target keyline.ID) iter.Seq2[keyline.Revocation, error] {
	return func(yield func(keyline.Revocation, error) bool) {
		for r, err := range tx.ReadTx.Revocations(ctx, target) {
			if !yield(r, err) || err != nil {
				return
			}
		}

		if tx.stage == "revocations" {
			yield(keyline.Revocation{}, tx.err)
		}
	}
}

type cancelingReadTx struct {
	keyline.ReadTx
	cancel context.CancelFunc
}

func (tx cancelingReadTx) DelegationsBySubject(ctx context.Context, subject keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return func(yield func(keyline.Delegation, error) bool) {
		for d, err := range tx.ReadTx.DelegationsBySubject(ctx, subject) {
			if !yield(d, err) || err != nil {
				return
			}

			tx.cancel()
		}
	}
}

func testQueryErrorsDeny(t *testing.T, newStore NewStore) {
	facts := testFacts{
		Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Write, 1}},
		Revocations: []keyline.Revocation{{"r", "stranger", "a", 2}},
	}
	errStorage := errors.New("storage failure after rows")
	store := facts.store(t, newStore)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		for _, stage := range []string{"delegations", "revocations", "canceled", "canceled during read"} {
			for _, query := range []string{"Allows", "EffectivePower", "Members", "IsLive", "Conveyed"} {
				t.Run(stage+"/"+query, func(t *testing.T) {
					// Each public query must encounter its own cancellation
					// during a read, not inherit a prior query's canceled ctx.
					ctx, cancel := context.WithCancel(t.Context())
					defer cancel()
					reader := keyline.ReadTx(failingReadTx{tx, stage, errStorage})
					wantErr := errStorage
					switch stage {
					case "canceled":
						cancel()
						reader = tx
						wantErr = context.Canceled
					case "canceled during read":
						reader = cancelingReadTx{tx, cancel}
						wantErr = context.Canceled
					}

					switch query {
					case "Allows":
						allowed, err := keyline.Allows(ctx, reader, "doc", "alice", keyline.Read)
						require.ErrorIs(t, err, wantErr)
						require.False(t, allowed)
					case "EffectivePower":
						power, err := keyline.EffectivePower(ctx, reader, "doc", "alice")
						require.ErrorIs(t, err, wantErr)
						require.Equal(t, keyline.None, power)
					case "Members":
						members, err := keyline.Members(ctx, reader, "doc")
						require.ErrorIs(t, err, wantErr)
						require.Nil(t, members)
					case "IsLive":
						live, err := keyline.IsLive(ctx, reader, "a")
						require.ErrorIs(t, err, wantErr)
						require.False(t, live)
					case "Conveyed":
						power, err := keyline.Conveyed(ctx, reader, "a")
						require.ErrorIs(t, err, wantErr)
						require.Equal(t, keyline.None, power)
					}
				})
			}
		}

		live, err := keyline.IsLive(t.Context(), failingReadTx{tx, "delegation", errStorage}, "a")
		require.ErrorIs(t, err, errStorage)
		require.False(t, live)
		power, err := keyline.Conveyed(t.Context(), failingReadTx{tx, "delegation", errStorage}, "a")
		require.ErrorIs(t, err, errStorage)
		require.Equal(t, keyline.None, power)
		return nil
	}))
}

// The read boundary promises that unrelated subjects and ungrounded issuers
// need not be accessible at all. Rejecting those reads catches global scans and
// exploring a role's internals before establishing its standing over the subject.
type scopedReadTx struct{ keyline.ReadTx }

func (tx scopedReadTx) Delegations(ctx context.Context, subject, issuer keyline.Node) iter.Seq2[keyline.Delegation, error] {
	if (subject != "doc" && subject != "alice") || (issuer != "doc" && issuer != "alice") {
		return func(yield func(keyline.Delegation, error) bool) {
			yield(keyline.Delegation{}, fmt.Errorf("read outside query closure: %q %q", subject, issuer))
		}
	}

	return tx.ReadTx.Delegations(ctx, subject, issuer)
}

func testQueriesIgnoreUnrelatedAuthority(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"a", "doc", "alice", "doc", keyline.Read, 1},
		{"ungrounded", "outsider", "expensive-role", "doc", keyline.Admin, 2},
	}}
	batch := keyline.Batch{Delegations: []keyline.Delegation{{"role", "expensive-role", "outsider", "expensive-role", keyline.Admin, 3}}}
	for i := range 10000 {
		n := keyline.Node(fmt.Sprintf("unrelated-%d", i))
		batch.Delegations = append(batch.Delegations, keyline.Delegation{keyline.ID(n), n, "outsider", n, keyline.Admin, int64(i + 4)})
	}

	store := facts.store(t, newStore)
	_, err := store.Apply(t.Context(), batch)
	require.NoError(t, err)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		members, err := keyline.Members(t.Context(), scopedReadTx{tx}, "doc")
		require.NoError(t, err)
		require.Equal(t, map[keyline.Node]keyline.Power{"alice": keyline.Read}, members)
		live, err := keyline.IsLive(t.Context(), scopedReadTx{tx}, "ungrounded")
		require.NoError(t, err)
		require.False(t, live)
		return nil
	}))
}

type repeatedReadTx struct{ keyline.ReadTx }

func (tx repeatedReadTx) Delegations(ctx context.Context, subject, issuer keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return func(yield func(keyline.Delegation, error) bool) {
		for d, err := range tx.ReadTx.Delegations(ctx, subject, issuer) {
			if !yield(d, err) || err != nil || !yield(d, nil) {
				return
			}
		}
	}
}

func (tx repeatedReadTx) Revocations(ctx context.Context, target keyline.ID) iter.Seq2[keyline.Revocation, error] {
	return func(yield func(keyline.Revocation, error) bool) {
		for r, err := range tx.ReadTx.Revocations(ctx, target) {
			if !yield(r, err) || err != nil || !yield(r, nil) {
				return
			}
		}
	}
}

func testDuplicateIteratorRows(t *testing.T, newStore NewStore) {
	facts := testFacts{
		Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Write, 1}, {"b", "alice", "bob", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r", "bob", "b", 3}},
	}
	store := facts.store(t, newStore)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		reader := repeatedReadTx{tx}
		delegations, revocations := 0, 0
		for _, err := range reader.Delegations(t.Context(), "doc", "doc") {
			require.NoError(t, err)
			delegations++
		}

		for _, err := range reader.Revocations(t.Context(), "b") {
			require.NoError(t, err)
			revocations++
		}

		require.Equal(t, 2, delegations)
		require.Equal(t, 2, revocations)
		members, err := keyline.Members(t.Context(), reader, "doc")
		require.NoError(t, err)
		require.Equal(t, map[keyline.Node]keyline.Power{"alice": keyline.Write}, members)
		return nil
	}))
}

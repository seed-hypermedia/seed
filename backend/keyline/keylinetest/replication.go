//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"slices"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

func readClosure(t *testing.T, store keyline.Store, subject keyline.Node) keyline.Batch {
	t.Helper()
	var batch keyline.Batch

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		batch, err = keyline.Collect(keyline.Closure(t.Context(), tx, subject))
		return err
	}))
	return batch
}

func readDigest(t *testing.T, store keyline.Store) [32]byte {
	t.Helper()
	var digest [32]byte

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		digest, err = keyline.Digest(t.Context(), tx)
		return err
	}))
	return digest
}

// upstream: scenarios::closure_holds_what_a_document_needs
func testPartialReplication(t *testing.T, newStore NewStore) {
	batch := keyline.Batch{
		Delegations: []keyline.Delegation{
			{"root", "doc", "role", "doc", keyline.Write, 1},
			{"alice", "role", "alice", "role", keyline.Admin, 2},
			{"bob", "role", "bob", "role", keyline.Admin, 3},
			{"carol", "alice", "carol", "doc", keyline.Write, 4},
			{"personal", "alice", "pinned", "alice", keyline.Read, 5},
			{"ungrounded", "outsider", "latent", "doc", keyline.Admin, 6},
			{"latent-role", "latent", "hidden", "latent", keyline.Admin, 7},
			{"unrelated", "elsewhere", "someone", "elsewhere", keyline.Admin, 8},
		},
		Revocations: []keyline.Revocation{
			{"remove-alice", "bob", "alice", 9},
			{"remove-junk", "outsider", "ungrounded", 10},
			{"inert", "stranger", "bob", 11},
			{"early", "doc", "late", 12},
		},
	}
	for i, node := range []keyline.Node{"doc", "role", "alice", "bob", "carol", "pinned", "outsider", "latent", "stranger", "hidden", "elsewhere", "someone"} {
		batch.Nodes = append(batch.Nodes, keyline.NodeRecord{node, int64(20 + i), int64(i), "blob-" + string(node)})
	}

	source := newStore(t)
	_, err := source.Apply(t.Context(), batch)
	require.NoError(t, err)
	// A giant unrelated population must not enter closure discovery or export.
	var unrelated keyline.Batch

	for i := range 2000 {
		n := keyline.Node(fmt.Sprintf("unrelated-%d", i))
		unrelated.Delegations = append(unrelated.Delegations, keyline.Delegation{keyline.ID(n), n, "someone", n, keyline.Admin, 99})
	}

	_, err = source.Apply(t.Context(), unrelated)
	require.NoError(t, err)

	var closure keyline.Batch

	require.NoError(t, source.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		closure, err = keyline.Collect(keyline.Closure(t.Context(), noGlobalScanTx{tx}, "doc"))
		return err
	}))
	require.ElementsMatch(t, batch.Delegations[:6], closure.Delegations)
	require.ElementsMatch(t, batch.Revocations[:3], closure.Revocations)
	require.ElementsMatch(t, batch.Nodes[:9], closure.Nodes)

	destination := newStore(t)
	// Blob IDs are local. Remapping them cannot change authority.
	imported := keyline.Batch{
		Nodes: slices.Clone(closure.Nodes), Delegations: slices.Clone(closure.Delegations), Revocations: slices.Clone(closure.Revocations),
	}
	for i := range imported.Nodes {
		imported.Nodes[i].BlobID += 1000
	}

	for i := range imported.Delegations {
		imported.Delegations[i].BlobID += 1000
	}

	for i := range imported.Revocations {
		imported.Revocations[i].BlobID += 1000
	}

	changed, err := destination.Apply(t.Context(), imported)
	require.NoError(t, err)
	require.True(t, changed)
	changed, err = destination.Apply(t.Context(), imported)
	require.NoError(t, err)
	require.False(t, changed)
	full, partial := testQueries{t, source}, testQueries{t, destination}
	require.Equal(t, map[keyline.Node]keyline.Power{"role": keyline.Write, "bob": keyline.Write}, partial.Members("doc"))
	require.Equal(t, full.Members("doc"), partial.Members("doc"))
	for _, d := range batch.Delegations[:6] {
		require.Equal(t, full.IsLive(d.ID), partial.IsLive(d.ID))
	}

	require.Empty(t, partial.Members("elsewhere"))

	// A late supply pulls an existing, previously unrelated role into scope.
	// A revocation omitted while its target was absent must arrive with it.
	_, err = source.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{
		{"connect", "doc", "elsewhere", "doc", keyline.Read, 100},
		{"late", "doc", "late-reader", "doc", keyline.Write, 101},
	}})
	require.NoError(t, err)
	expanded := readClosure(t, source, "doc")
	require.Subset(t, expanded.Delegations, closure.Delegations)
	require.Subset(t, expanded.Revocations, closure.Revocations)
	require.Contains(t, expanded.Delegations, batch.Delegations[7])
	require.Contains(t, expanded.Revocations, batch.Revocations[3])
	late := newStore(t)
	_, err = late.Apply(t.Context(), closure)
	require.NoError(t, err)
	_, err = late.Apply(t.Context(), expanded)
	require.NoError(t, err)
	q := testQueries{t, late}
	require.Equal(t, (testQueries{t, source}).Members("doc"), q.Members("doc"))
	require.Equal(t, keyline.Read, q.EffectivePower("doc", "someone"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "late-reader"))
}

// Scoped graph operations must never fall back to whole-store enumeration.
type noGlobalScanTx struct{ keyline.ReadTx }

func (noGlobalScanTx) Records(context.Context) iter.Seq2[keyline.Record, error] {
	panic("closure scanned the entire store")
}

func (noGlobalScanTx) Subjects(context.Context) iter.Seq2[keyline.Node, error] {
	panic("closure enumerated unrelated subjects")
}

func testClosureEmptyAndNodeOnly(t *testing.T, newStore NewStore) {
	store := newStore(t)
	require.Equal(t, keyline.Batch{}, readClosure(t, store, "unknown"))
	_, err := store.Apply(t.Context(), keyline.Batch{Nodes: []keyline.NodeRecord{{"standalone", 1, 0, "standalone-blob"}}})
	require.NoError(t, err)
	require.Equal(t, keyline.Batch{Nodes: []keyline.NodeRecord{{"standalone", 1, 0, "standalone-blob"}}}, readClosure(t, store, "standalone"))
	require.Equal(t, keyline.Batch{}, readClosure(t, store, ""))
}

func testPositiveAndSubsetQueries(t *testing.T, newStore NewStore) {
	batch := keyline.Batch{
		Delegations: []keyline.Delegation{{"root", "s", "a", "s", keyline.Admin, 1}, {"child", "a", "b", "s", keyline.Write, 2}},
		Revocations: []keyline.Revocation{{"r", "a", "root", 3}},
	}
	store := newStore(t)
	_, err := store.Apply(t.Context(), batch)
	require.NoError(t, err)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		power, err := keyline.PositivePower(t.Context(), failingReadTx{tx, "revocations", errors.New("must not read revocations")}, "s", "b")
		require.NoError(t, err)
		require.Equal(t, keyline.Write, power)
		power, err = keyline.EffectivePower(t.Context(), tx, "s", "b")
		require.NoError(t, err)
		require.Equal(t, keyline.None, power)
		for _, tc := range []struct {
			ids  []keyline.ID
			want map[keyline.Node]keyline.Power
		}{
			{nil, map[keyline.Node]keyline.Power{}},
			{[]keyline.ID{"child", "missing"}, map[keyline.Node]keyline.Power{}},
			{[]keyline.ID{"root", "root", "child", "missing"}, map[keyline.Node]keyline.Power{"a": keyline.Admin, "b": keyline.Write}},
			{[]keyline.ID{"root", "child", "r"}, map[keyline.Node]keyline.Power{}},
		} {
			got, err := keyline.MembersForSubset(t.Context(), tx, "s", tc.ids)
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		}

		return nil
	}))
}

func testDigestIdentity(t *testing.T, newStore NewStore) {
	base := keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"s", 7, 0, "s-blob"}},
		Delegations: []keyline.Delegation{{"z", "s", "b\x00\xff", "s", keyline.Write, 1}, {"a", "s", "a", "s", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r", "s", "missing", 3}},
	}
	var want [32]byte

	store := newStore(t)
	_, err := store.Apply(t.Context(), base)
	require.NoError(t, err)

	got := readDigest(t, store)
	if want == ([32]byte{}) {
		want = got
	}

	require.Equal(t, want, got)
	replica := newStore(t)
	for _, r := range slices.Backward(base.Revocations) {
		r.BlobID += 100
		_, err = replica.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{r}})
		require.NoError(t, err)
	}

	for _, d := range slices.Backward(base.Delegations) {
		d.BlobID += 100
		_, err = replica.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{d}})
		require.NoError(t, err)
	}

	require.Equal(t, got, readDigest(t, replica), "local provenance, metadata, and batching cannot change a fact digest")
	// Opaque IDs are not content addresses: changing semantic fields with
	// the same IDs in an independent store must change the fingerprint.
	other := newStore(t)
	changed := keyline.Batch{Delegations: slices.Clone(base.Delegations), Revocations: base.Revocations}
	changed.Delegations[0].Power = keyline.Read
	_, err = other.Apply(t.Context(), changed)
	require.NoError(t, err)
	require.NotEqual(t, got, readDigest(t, other))
}

type exportFailureTx struct {
	keyline.ReadTx
	stage string
	err   error
}

func (tx exportFailureTx) DelegationsBySubject(ctx context.Context, subject keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return func(yield func(keyline.Delegation, error) bool) {
		for d, err := range tx.ReadTx.DelegationsBySubject(ctx, subject) {
			if !yield(d, err) || err != nil {
				return
			}
		}

		if tx.stage == "subject" {
			yield(keyline.Delegation{}, tx.err)
		}
	}
}

func (tx exportFailureTx) Node(ctx context.Context, node keyline.Node) (keyline.NodeRecord, bool, error) {
	if tx.stage == "node" {
		return keyline.NodeRecord{}, false, tx.err
	}

	return tx.ReadTx.Node(ctx, node)
}

func (tx exportFailureTx) Records(ctx context.Context) iter.Seq2[keyline.Record, error] {
	return func(yield func(keyline.Record, error) bool) {
		for r, err := range tx.ReadTx.Records(ctx) {
			if !yield(r, err) || err != nil {
				return
			}
		}

		yield(nil, tx.err)
	}
}

func testReplicationFailures(t *testing.T, newStore NewStore) {
	store := newStore(t)
	_, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"d", "s", "a", "s", keyline.Write, 1}}})
	require.NoError(t, err)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		failure := errors.New("storage failed")
		for _, broken := range []keyline.ReadTx{
			failingReadTx{tx, "delegations", failure},
			failingReadTx{tx, "revocations", failure},
			exportFailureTx{tx, "subject", failure},
			exportFailureTx{tx, "node", failure},
		} {
			batch, err := keyline.Collect(keyline.Closure(t.Context(), broken, "s"))
			require.ErrorIs(t, err, failure)
			require.Equal(t, keyline.Batch{}, batch)
		}

		digest, err := keyline.Digest(t.Context(), exportFailureTx{tx, "records", failure})
		require.ErrorIs(t, err, failure)
		require.Zero(t, digest)
		members, err := keyline.MembersForSubset(t.Context(), failingReadTx{tx, "revocations", failure}, "s", []keyline.ID{"d"})
		require.ErrorIs(t, err, failure)
		require.Nil(t, members)
		// Error, cancellation, early break and panic must all release cursors.
		ctx, cancel := context.WithCancel(t.Context())
		var seen, failures int

		for r, err := range keyline.Closure(ctx, tx, "s") {
			if err != nil {
				require.ErrorIs(t, err, context.Canceled)
				require.Nil(t, r)
				failures++
			} else {
				seen++
				cancel()
			}
		}

		cancel()
		require.Equal(t, 1, seen)
		require.Equal(t, 1, failures)
		for _, err := range keyline.Closure(t.Context(), tx, "s") {
			require.NoError(t, err)
			break
		}

		require.Panics(t, func() {
			for _, err := range keyline.Closure(t.Context(), tx, "s") {
				require.NoError(t, err)
				panic("consumer")
			}
		})
		batch, err := keyline.Collect(keyline.Closure(t.Context(), tx, "s"))
		require.NoError(t, err)
		require.Len(t, batch.Delegations, 1)
		return nil
	}))
}

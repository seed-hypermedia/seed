package conformance

import (
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// These laws cover Go-only API that upstream has no law for: MembersOf and
// Evaluator.Parent. They run on the same generated inputs as the ported laws.

// membersOfMatchesMembers checks that evaluating several subjects together
// answers exactly as evaluating each one alone.
func membersOfMatchesMembers(t *testing.T, st *stores, set certSet, _ uint64) {
	store := st.build(t, set)
	together := readTest(t, store, func(tx keyline.ReadTx) (map[keyline.Node]map[keyline.Node]keyline.Power, error) {
		return keyline.MembersOf(t.Context(), tx, poolNodes())
	})
	for _, s := range poolNodes() {
		require.Equal(t, members(t, store, s), together[s], "members of %s", s)
	}
}

// computedParentsMatchStoredEdges checks that Evaluator.Parent answers as if
// each parent edge were stored as an unrevoked Admin delegation. The seed picks
// an acyclic parent for some pool nodes.
func computedParentsMatchStoredEdges(t *testing.T, st *stores, set certSet, seed uint64) {
	parents := map[keyline.Node]keyline.Node{}
	nodes := poolNodes()
	for i := 1; i < len(nodes); i++ {
		if seed>>i&1 == 1 {
			parents[nodes[i]] = nodes[(seed>>(i+8))%uint64(i)]
		}
	}

	computed := keyline.Evaluator{Parent: func(n keyline.Node) (keyline.Node, bool) {
		p, ok := parents[n]
		return p, ok
	}}

	stored := st.fresh(t)
	batch := set.batch()
	for child, parent := range parents {
		batch.Delegations = append(batch.Delegations, keyline.Delegation{
			ID: keyline.ID("parent:" + child), Issuer: child, Audience: parent, Subject: child, Power: keyline.Admin, BlobID: 1,
		})
	}

	_, err := stored.Apply(t.Context(), batch)
	require.NoError(t, err)
	plain := st.build(t, set)
	for _, s := range nodes {
		want := members(t, stored, s)
		got := readTest(t, plain, func(tx keyline.ReadTx) (map[keyline.Node]keyline.Power, error) {
			return computed.Members(t.Context(), tx, s)
		})
		require.Equal(t, want, got, "members of %s", s)
	}

	for _, d := range set.delegations() {
		want := conveyed(t, stored, d.ID)
		got := readTest(t, plain, func(tx keyline.ReadTx) (keyline.Power, error) {
			return computed.Conveyed(t.Context(), tx, d.ID)
		})
		require.Equal(t, want, got, "conveyed(%s)", d.ID)
	}
}

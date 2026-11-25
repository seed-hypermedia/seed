package conformance

import (
	"context"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// These laws cover Go-only API that upstream has no law for: MembersOf, and the
// optional EdgeStore and Authorizer extensions a store's ReadTx may implement.
// They run on the same generated inputs as the ported laws.

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

// EdgeStore is an optional ReadTx extension for stores that keep evaluated
// edges: for each audience, the strongest power a subject's live delegations
// convey to it. The laws check it against keyline.Conveyed, which evaluates
// from raw facts, so a store's own maintenance never feeds the oracle.
type EdgeStore interface {
	// StoredEdges returns subject's stored edges, excluding subject itself.
	StoredEdges(ctx context.Context, subject keyline.Node) (map[keyline.Node]keyline.Power, error)
}

// Authorizer is an optional ReadTx extension for stores that answer
// authority checks their own way, such as from stored edges. The laws check it
// against keyline.Members.
type Authorizer interface {
	// Allows reports whether audience holds at least required over subject.
	Allows(ctx context.Context, subject, audience keyline.Node, required keyline.Power) (bool, error)
}

// edgesComposeToMembers checks the definition the edge laws rely on: the
// widest-path closure of the edges keyline.Conveyed implies equals Members.
func edgesComposeToMembers(t *testing.T, st *stores, set certSet, _ uint64) {
	store := st.build(t, set)
	edges := conveyedEdges(t, store, set)
	for _, s := range poolNodes() {
		require.Equal(t, members(t, store, s), widestPaths(edges, s), "closure of edges from %s", s)
	}
}

// storedEdgesMatchConveyed checks an EdgeStore's maintained edges, and an
// Authorizer's answers, against the core evaluation. Stores are built record by
// record in several orders, in split batches, and with the whole set reapplied,
// so incremental maintenance sees grants and revocations arrive before and
// after what they depend on.
func storedEdgesMatchConveyed(t *testing.T, st *stores, set certSet, seed uint64) {
	probe := st.fresh(t)
	var isEdgeStore, isAuthorizer bool

	require.NoError(t, probe.View(t.Context(), func(tx keyline.ReadTx) error {
		_, isEdgeStore = tx.(EdgeStore)
		_, isAuthorizer = tx.(Authorizer)
		return nil
	}))

	if !isEdgeStore && !isAuthorizer {
		t.Skip("store keeps no edges and has no own Allows")
	}

	revocationsLast := append(certSet(nil), set.withoutRevocations()...)
	for _, r := range set.revocations() {
		revocationsLast = append(revocationsLast, r)
	}

	orders := map[string]certSet{
		"generation order":    set,
		"shuffled":            set.shuffled(seed),
		"reversed":            set.reversed(),
		"revocations last":    revocationsLast,
		"without revocations": set.withoutRevocations(),
	}

	check := func(name string, store keyline.Store, records certSet) {
		want := conveyedEdges(t, store, records)
		for _, s := range poolNodes() {
			if isEdgeStore {
				got := readTest(t, store, func(tx keyline.ReadTx) (map[keyline.Node]keyline.Power, error) {
					return tx.(EdgeStore).StoredEdges(t.Context(), s)
				})
				require.Equal(t, normalize(want[s]), normalize(got), "%s: stored edges of %s", name, s)
			}

			if !isAuthorizer {
				continue
			}

			m := members(t, store, s)
			for _, a := range poolNodes() {
				for _, p := range powerOrder[1:] {
					allowed := readTest(t, store, func(tx keyline.ReadTx) (bool, error) {
						return tx.(Authorizer).Allows(t.Context(), s, a, p)
					})
					require.Equal(t, s == a || rank(m[a]) >= rank(p), allowed, "%s: Allows(%s, %s, %s)", name, s, a, p)
				}
			}
		}
	}

	for name, records := range orders {
		check(name, st.build(t, records), records)
	}

	// Split batches, then the whole set again: reapplying known facts must
	// leave the edges as they are.
	at := int(seed%256) % (len(set) + 1) //nolint:gosec // At most 255.
	store := st.fresh(t)
	for _, b := range []certSet{set[:at], set[at:], set} {
		_, err := store.Apply(t.Context(), b.batch())
		require.NoError(t, err)
	}

	check("split batches", store, set)
}

// conveyedEdges returns the edges keyline.Conveyed implies for records: per
// subject and audience, the strongest power one delegation conveys.
func conveyedEdges(t *testing.T, store keyline.Store, records certSet) map[keyline.Node]map[keyline.Node]keyline.Power {
	out := map[keyline.Node]map[keyline.Node]keyline.Power{}
	for _, d := range records.delegations() {
		p := readTest(t, store, func(tx keyline.ReadTx) (keyline.Power, error) {
			return keyline.Conveyed(t.Context(), tx, d.ID)
		})
		if p == keyline.None || d.Audience == d.Subject {
			continue
		}

		if out[d.Subject] == nil {
			out[d.Subject] = map[keyline.Node]keyline.Power{}
		}

		if rank(p) > rank(out[d.Subject][d.Audience]) {
			out[d.Subject][d.Audience] = p
		}
	}

	return out
}

// normalize treats a nil map and an empty one alike.
func normalize(m map[keyline.Node]keyline.Power) map[keyline.Node]keyline.Power {
	if len(m) == 0 {
		return nil
	}

	return m
}

// widestPaths returns every node but s reachable from s over edges, each with
// the strongest of the weakest edge powers along its chains.
func widestPaths(edges map[keyline.Node]map[keyline.Node]keyline.Power, s keyline.Node) map[keyline.Node]keyline.Power {
	best := map[keyline.Node]keyline.Power{s: keyline.Admin}
	for changed := true; changed; {
		changed = false
		for x, row := range edges {
			for a, p := range row {
				if best[x] == keyline.None {
					continue
				}

				if p = powerOrder[min(rank(best[x]), rank(p))]; rank(p) > rank(best[a]) {
					best[a] = p
					changed = true
				}
			}
		}
	}

	delete(best, s)
	return best
}

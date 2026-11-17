package conformance

import (
	"maps"
	"slices"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// These laws port conformance/laws.rs (Apache-2.0, revision in keyline.go), one
// function per upstream law with the same name. Each takes a generated set and
// the extra seed some upstream laws draw alongside it.

// observed ports laws.rs Observed: every pool level and the live delegations.
type observed struct {
	levels levels
	live   map[keyline.ID]bool
}

// observe ports laws.rs observe, reading levels through Members.
func observe(t *testing.T, store keyline.Store, set certSet) observed {
	t.Helper()
	o := observed{levels: levels{}, live: map[keyline.ID]bool{}}
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		for _, s := range poolNodes() {
			members, err := keyline.Members(t.Context(), tx, s)
			require.NoError(t, err)
			for x, l := range members {
				o.levels[[2]keyline.Node{s, x}] = l
			}

			o.levels[[2]keyline.Node{s, s}] = keyline.Admin
		}

		for _, d := range set.delegations() {
			live, err := keyline.IsLive(t.Context(), tx, d.ID)
			require.NoError(t, err)

			if live {
				o.live[d.ID] = true
			}
		}

		return nil
	}))
	return o
}

// membersOf ports laws.rs members_of: every node but s with a level over s.
func membersOf(lv levels, s keyline.Node) map[keyline.Node]keyline.Power {
	out := map[keyline.Node]keyline.Power{}
	for q, l := range lv {
		if q[0] == s && q[1] != s && l != keyline.None {
			out[q[1]] = l
		}
	}

	return out
}

func members(t *testing.T, store keyline.Store, s keyline.Node) map[keyline.Node]keyline.Power {
	t.Helper()
	return readTest(t, store, func(tx keyline.ReadTx) (map[keyline.Node]keyline.Power, error) {
		return keyline.Members(t.Context(), tx, s)
	})
}

// positiveLevels reads PositivePower for every pool pair in one transaction.
func positiveLevels(t *testing.T, store keyline.Store) levels {
	t.Helper()
	return readTest(t, store, func(tx keyline.ReadTx) (levels, error) {
		out := levels{}
		for _, s := range poolNodes() {
			for _, x := range poolNodes() {
				p, err := keyline.PositivePower(t.Context(), tx, s, x)
				if err != nil {
					return nil, err
				}

				out[[2]keyline.Node{s, x}] = p
			}
		}

		return out, nil
	})
}

func conveyed(t *testing.T, store keyline.Store, id keyline.ID) keyline.Power {
	t.Helper()
	return readTest(t, store, func(tx keyline.ReadTx) (keyline.Power, error) {
		return keyline.Conveyed(t.Context(), tx, id)
	})
}

func closureOf(t *testing.T, store keyline.Store, s keyline.Node) certSet {
	t.Helper()
	b := readClosure(t, store, s)
	var c certSet

	for _, d := range b.Delegations {
		c = append(c, d)
	}

	for _, r := range b.Revocations {
		c = append(c, r)
	}

	return c
}

func ids(c certSet) map[keyline.ID]bool {
	out := map[keyline.ID]bool{}
	for _, r := range c {
		out[recordID(r)] = true
	}

	return out
}

// upstream: laws::matches_naive_oracle_without_revocations
func matchesNaiveOracleWithoutRevocations(t *testing.T, st *stores, set certSet, _ uint64) {
	set = set.withoutRevocations()
	expected := naiveReaches(set.facts())
	k := st.build(t, set)
	for _, s := range poolNodes() {
		require.Equal(t, membersOf(expected, s), members(t, k, s), "members(%s)", s)
	}

	q := testQueries{t, k}
	for _, d := range set.delegations() {
		_, reaches := expected[[2]keyline.Node{d.Subject, d.Issuer}]
		require.Equal(t, reaches, q.IsLive(d.ID), "IsLive(%s)", d.ID)
	}
}

// Conveyed is checked against the naive caps, as upstream checks conveyed_power.
//
// upstream: laws::matches_naive_oracle_with_revocations
func matchesNaiveOracleWithRevocations(t *testing.T, st *stores, set certSet, _ uint64) {
	live, caps, lv := naiveEvaluation(set.facts())
	k := st.build(t, set)
	for _, s := range poolNodes() {
		require.Equal(t, membersOf(lv, s), members(t, k, s), "members(%s)", s)
	}

	q := testQueries{t, k}
	for _, d := range set.delegations() {
		require.Equal(t, live[d.ID], q.IsLive(d.ID), "IsLive(%s)", d.ID)

		want := keyline.None
		if live[d.ID] {
			want = caps[d.ID]
		}

		require.Equal(t, want, conveyed(t, k, d.ID), "Conveyed(%s)", d.ID)
	}
}

// The Go threshold oracle also derives conveyed powers, so they are checked here too.
//
// upstream: laws::matches_threshold_oracle
func matchesThresholdOracle(t *testing.T, st *stores, set certSet, _ uint64) {
	powers, live, wantConveyed := thresholdEvaluation(set.facts())
	k := st.build(t, set)
	for _, s := range poolNodes() {
		require.Equal(t, membersOf(powers, s), members(t, k, s), "members(%s)", s)
	}

	q := testQueries{t, k}
	for _, d := range set.delegations() {
		require.Equal(t, live[d.ID], q.IsLive(d.ID), "IsLive(%s)", d.ID)
		require.Equal(t, wantConveyed[d.ID], conveyed(t, k, d.ID), "Conveyed(%s)", d.ID)
	}
}

// upstream: laws::party_revocation_is_total
func partyRevocationIsTotal(t *testing.T, st *stores, set certSet, _ uint64) {
	q := testQueries{t, st.build(t, set)}
	for _, r := range set.revocations() {
		party := slices.ContainsFunc(set.delegations(), func(d keyline.Delegation) bool {
			return d.ID == r.Target && (r.Issuer == d.Issuer || r.Issuer == d.Audience)
		})
		if party {
			require.False(t, q.IsLive(r.Target), "%v is by a party to its target", r)
		}
	}
}

// upstream: laws::order_independent
func orderIndependent(t *testing.T, st *stores, set certSet, seed uint64) {
	a := st.build(t, set)
	for _, order := range []certSet{set.shuffled(seed), set.reversed()} {
		b := st.build(t, order)
		require.Equal(t, readDigest(t, a), readDigest(t, b))
		require.Equal(t, observe(t, a, set), observe(t, b, set))
	}
}

// Reinserting known records leaves the shared store unchanged, as this law checks.
//
// upstream: laws::idempotent
func idempotent(t *testing.T, st *stores, set certSet, _ uint64) {
	k := st.build(t, set)
	digest, before := readDigest(t, k), observe(t, k, set)
	for _, r := range set {
		changed, err := k.Apply(t.Context(), certSet{r}.batch())
		require.NoError(t, err)
		require.False(t, changed)
	}

	require.Equal(t, digest, readDigest(t, k))
	require.Equal(t, before, observe(t, k, set))
}

// upstream: laws::revocations_only_deny
func revocationsOnlyDeny(t *testing.T, st *stores, set certSet, _ uint64) {
	after := observe(t, st.build(t, set), set)
	for i, r := range set {
		if _, ok := r.(keyline.Revocation); !ok {
			continue
		}

		before := observe(t, st.build(t, set.without(i)), set)
		for key, l := range after.levels {
			b, ok := before.levels[key]
			require.True(t, ok && rank(b) >= rank(l), "revocation %d raised %v to %s", i, key, l)
		}

		for id := range after.live {
			require.True(t, before.live[id], "revocation %d revived %s", i, id)
		}
	}
}

// Go digests are local fingerprints, so upstream's equality with set_digest
// has no counterpart. backend/keyline/TODO.md tracks restoring an
// expected-value check.
//
// upstream: laws::digest_identifies_the_set
func digestIdentifiesTheSet(t *testing.T, st *stores, set certSet, seed uint64) {
	a := readDigest(t, st.build(t, set))
	require.Equal(t, a, readDigest(t, st.build(t, set.shuffled(seed))))
	for i := range set {
		// Removing one copy of a duplicated fact leaves the set unchanged.
		if set.count(i) > 1 {
			continue
		}

		require.NotEqual(t, a, readDigest(t, st.build(t, set.without(i))), "dropping fact %d", i)
	}
}

// upstream: laws::queries_are_consistent
func queriesAreConsistent(t *testing.T, st *stores, set certSet, _ uint64) {
	k := st.build(t, set)
	q := testQueries{t, k}
	for _, s := range poolNodes() {
		require.Equal(t, keyline.Admin, q.EffectivePower(s, s))

		m := q.Members(s)
		require.NotContains(t, m, s)
		for _, x := range poolNodes() {
			if x != s {
				require.Equal(t, q.EffectivePower(s, x), m[x], "members(%s)[%s]", s, x)
			}
		}
	}

	contains := func(store keyline.Store, r keyline.Record) bool {
		return readTest(t, store, func(tx keyline.ReadTx) (bool, error) {
			switch r := r.(type) {
			case keyline.Delegation:
				_, found, err := tx.Delegation(t.Context(), r.ID)
				return found, err
			case keyline.Revocation:
				_, found, err := tx.Revocation(t.Context(), r.ID)
				return found, err
			}

			return false, nil
		})
	}

	for i, r := range set {
		require.True(t, contains(k, r), "contains(%s)", recordID(r))

		if set.count(i) == 1 {
			require.False(t, contains(st.build(t, set.without(i)), r), "contains(%s) once dropped", recordID(r))
		}
	}

	// Every target named, present or not: a revocation that arrives before its
	// target must already be listed.
	var targets []keyline.ID

	for _, d := range set.delegations() {
		targets = append(targets, d.ID)
	}

	for _, r := range set.revocations() {
		targets = append(targets, r.Target)
	}

	for _, target := range targets {
		want := map[keyline.ID]keyline.Revocation{}
		for _, r := range set.revocations() {
			if r.Target == target {
				want[r.ID] = r
			}
		}

		got := readTest(t, k, func(tx keyline.ReadTx) ([]keyline.Revocation, error) {
			return collectEnumeration(t, tx.Revocations(t.Context(), target)), nil
		})
		require.ElementsMatch(t, slices.Collect(maps.Values(want)), got, "Revocations(%s)", target)
	}
}

// upstream: laws::conveyed_power_is_what_a_delegation_contributes
func conveyedPowerIsWhatADelegationContributes(t *testing.T, st *stores, set certSet, _ uint64) {
	k := st.build(t, set)
	q := testQueries{t, k}
	for _, d := range set.delegations() {
		if l := conveyed(t, k, d.ID); l != keyline.None {
			require.LessOrEqual(t, rank(l), rank(d.Power), "%v", d)
			require.LessOrEqual(t, rank(l), rank(q.EffectivePower(d.Subject, d.Issuer)), "%v", d)
			require.LessOrEqual(t, rank(l), rank(q.EffectivePower(d.Subject, d.Audience)), "%v", d)
		}
	}

	for _, s := range poolNodes() {
		for _, a := range poolNodes() {
			if a == s || slices.ContainsFunc(set.delegations(), func(d keyline.Delegation) bool {
				return d.Audience == a && d.Subject != s
			}) {
				continue
			}

			greatest := keyline.None
			for _, d := range set.delegations() {
				if d.Audience == a {
					if l := conveyed(t, k, d.ID); rank(l) > rank(greatest) {
						greatest = l
					}
				}
			}

			require.Equal(t, greatest, q.EffectivePower(s, a), "(%s, %s)", s, a)
		}
	}
}

// upstream: laws::positive_power_matches_stratum_one
func positivePowerMatchesStratumOne(t *testing.T, st *stores, set certSet, _ uint64) {
	expected := naiveReaches(set.withoutRevocations().facts())
	got := positiveLevels(t, st.build(t, set))
	for _, s := range poolNodes() {
		for _, x := range poolNodes() {
			want := expected[[2]keyline.Node{s, x}]
			if s == x {
				want = keyline.Admin
			}

			require.Equal(t, want, got[[2]keyline.Node{s, x}], "PositivePower(%s, %s)", s, x)
		}
	}
}

// upstream: laws::positive_power_is_monotone
func positivePowerIsMonotone(t *testing.T, st *stores, set certSet, _ uint64) {
	all := positiveLevels(t, st.build(t, set))
	for i := range set {
		for q, p := range positiveLevels(t, st.build(t, set.without(i))) {
			require.LessOrEqual(t, rank(p), rank(all[q]), "fact %d lowered PositivePower%v", i, q)
		}
	}
}

// Records lists node records, then delegations, then revocations, each group
// in ID order, where upstream lists all certificates in one ID order.
//
// upstream: laws::listings_match_the_set
func listingsMatchTheSet(t *testing.T, st *stores, set certSet, _ uint64) {
	k := st.build(t, set)

	var want []keyline.Record

	for _, group := range []certSet{set.withoutRevocations(), slices.DeleteFunc(slices.Clone(set), func(r keyline.Record) bool {
		_, ok := r.(keyline.Delegation)
		return ok
	})} {
		slices.SortFunc(group, func(a, b keyline.Record) int { return cmpID(recordID(a), recordID(b)) })
		want = append(want, slices.CompactFunc(group, func(a, b keyline.Record) bool { return recordID(a) == recordID(b) })...)
	}

	require.Equal(t, want, readTest(t, k, func(tx keyline.ReadTx) ([]keyline.Record, error) {
		return collectEnumeration(t, tx.Records(t.Context())), nil
	}), "Records lists the set in ID order")

	get := func(store keyline.Store, id keyline.ID) keyline.Record {
		return readTest(t, store, func(tx keyline.ReadTx) (keyline.Record, error) {
			if d, found, err := tx.Delegation(t.Context(), id); err != nil || found {
				return d, err
			}

			r, found, err := tx.Revocation(t.Context(), id)
			if !found {
				return nil, err
			}

			return r, err
		})
	}

	for i, r := range set {
		require.Equal(t, r, get(k, recordID(r)), "get(%s)", recordID(r))

		if set.count(i) == 1 {
			require.Nil(t, get(st.build(t, set.without(i)), recordID(r)), "get of a missing fact")
		}
	}

	subjects := map[keyline.Node]bool{}
	for _, d := range set.delegations() {
		subjects[d.Subject] = true
	}

	for _, s := range poolNodes() {
		for _, a := range poolNodes() {
			want := map[keyline.ID]keyline.Delegation{}
			for _, d := range set.delegations() {
				if d.Subject == s && d.Audience == a {
					want[d.ID] = d
				}
			}

			got := readTest(t, k, func(tx keyline.ReadTx) ([]keyline.Delegation, error) {
				return collectEnumeration(t, tx.DelegationsTo(t.Context(), s, a)), nil
			})
			require.ElementsMatch(t, slices.Collect(maps.Values(want)), got, "DelegationsTo(%s, %s)", s, a)
		}
	}

	require.Equal(t, slices.Sorted(maps.Keys(subjects)), readTest(t, k, func(tx keyline.ReadTx) ([]keyline.Node, error) {
		return collectEnumeration(t, tx.Subjects(t.Context())), nil
	}), "Subjects")
}

func cmpID(a, b keyline.ID) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}

	return 0
}

// Go also checks that the closure preserves each delegation's Conveyed power,
// which callers read before removal. Upstream rebuilds the smaller store per
// subject; here each is built once and checked for every subject.
//
// upstream: laws::closure_is_sufficient
func closureIsSufficient(t *testing.T, st *stores, set certSet, _ uint64) {
	all := st.build(t, set)
	closures := map[keyline.Node]map[keyline.ID]bool{}
	for _, s := range poolNodes() {
		closure := closureOf(t, all, s)
		closures[s] = ids(closure)
		only := st.build(t, closure)
		require.Equal(t, members(t, all, s), members(t, only, s), "members(%s) from its closure", s)
		allPositive, onlyPositive := positiveLevels(t, all), positiveLevels(t, only)
		for _, x := range poolNodes() {
			q := [2]keyline.Node{s, x}
			require.Equal(t, allPositive[q], onlyPositive[q], "PositivePower(%s, %s) from the closure of %s", s, x, s)
		}

		for _, d := range set.delegations() {
			if d.Subject == s {
				require.Equal(t, (testQueries{t, all}).IsLive(d.ID), (testQueries{t, only}).IsLive(d.ID), "IsLive(%s) from the closure of %s", d.ID, s)
				require.Equal(t, conveyed(t, all, d.ID), conveyed(t, only, d.ID), "Conveyed(%s) from the closure of %s", d.ID, s)
			}
		}
	}

	for i := range set {
		fewer := st.build(t, set.without(i))
		for _, s := range poolNodes() {
			for id := range ids(closureOf(t, fewer, s)) {
				require.True(t, closures[s][id], "dropping fact %d grew the closure of %s with %s", i, s, id)
			}
		}
	}
}

// upstream: laws::members_for_subset_answers_as_the_subset
func membersForSubsetAnswersAsTheSubset(t *testing.T, st *stores, set certSet, mask uint64) {
	all := st.build(t, set)

	var kept certSet

	for i, r := range set {
		if mask>>(i%64)&1 == 1 {
			kept = append(kept, r)
		}
	}

	only := st.build(t, kept)
	subset, everything := slices.Collect(maps.Keys(ids(kept))), slices.Collect(maps.Keys(ids(set)))
	subsetMembers := func(store keyline.Store, s keyline.Node, selection []keyline.ID) map[keyline.Node]keyline.Power {
		return readTest(t, store, func(tx keyline.ReadTx) (map[keyline.Node]keyline.Power, error) {
			return keyline.MembersForSubset(t.Context(), tx, s, selection)
		})
	}

	for _, s := range poolNodes() {
		require.Equal(t, members(t, only, s), subsetMembers(all, s, subset), "MembersForSubset(%s) over %d of %d facts", s, len(subset), len(everything))

		if len(subset) != len(everything) {
			require.Equal(t, members(t, only, s), subsetMembers(only, s, everything), "MembersForSubset(%s) naming facts the store lacks", s)
		}
	}
}

// upstream: laws::batches_equal_singles
func batchesEqualSingles(t *testing.T, st *stores, set certSet, split uint64) {
	singles := st.build(t, set)
	digest, expected := readDigest(t, singles), observe(t, singles, set)

	at := int(split%256) % (len(set) + 1) //nolint:gosec // At most 255.
	for name, batches := range map[string][]certSet{"one batch": {set}, "two batches": {set[:at], set[at:]}} {
		store := st.fresh(t)
		for _, b := range batches {
			_, err := store.Apply(t.Context(), b.batch())
			require.NoError(t, err)
		}

		require.Equal(t, digest, readDigest(t, store), name)
		require.Equal(t, expected, observe(t, store, set), name)
	}
}

// upstream: laws::interleaving_is_invisible
func interleavingIsInvisible(t *testing.T, st *stores, set certSet, _ uint64) {
	fresh := st.build(t, set)
	expected := observe(t, fresh, set)

	k := st.fresh(t)
	for _, r := range set {
		_, err := k.Apply(t.Context(), certSet{r}.batch())
		require.NoError(t, err)
		// Touch every query that a cache could serve stale.
		_ = observe(t, k, set)
		_ = positiveLevels(t, k)
		for _, s := range poolNodes() {
			_ = closureOf(t, k, s)
		}
	}

	require.Equal(t, expected, observe(t, k, set))
	require.Equal(t, positiveLevels(t, fresh), positiveLevels(t, k))
	for _, s := range poolNodes() {
		require.ElementsMatch(t, closureOf(t, fresh, s), closureOf(t, k, s), "Closure(%s)", s)
	}
}

// oraclesAgree ports laws.rs's oracles_agree unit test: the value form and the
// threshold form agree with each other with no store in between.
func oraclesAgree(t *testing.T, set certSet) {
	powers, thresholdLive, _ := thresholdEvaluation(set.facts())
	naiveLive, _, lv := naiveEvaluation(set.facts())
	for _, d := range set.delegations() {
		require.Equal(t, naiveLive[d.ID], thresholdLive[d.ID], "live(%s)", d.ID)
	}

	for _, s := range poolNodes() {
		require.Equal(t, membersOf(lv, s), membersOf(powers, s), "levels over %s", s)
	}
}

// runLaws runs every ported law on one generated input.
func runLaws(t *testing.T, newStore NewStore, set certSet, seed uint64) {
	st := &stores{parent: t, newStore: newStore, built: map[string]keyline.Store{}}
	t.Run("oracles_agree", func(t *testing.T) { oraclesAgree(t, set) })
	for _, law := range []struct {
		name string
		run  func(*testing.T, *stores, certSet, uint64)
	}{
		{"matches_naive_oracle_without_revocations", matchesNaiveOracleWithoutRevocations},
		{"matches_naive_oracle_with_revocations", matchesNaiveOracleWithRevocations},
		{"matches_threshold_oracle", matchesThresholdOracle},
		{"party_revocation_is_total", partyRevocationIsTotal},
		{"order_independent", orderIndependent},
		{"idempotent", idempotent},
		{"revocations_only_deny", revocationsOnlyDeny},
		{"digest_identifies_the_set", digestIdentifiesTheSet},
		{"queries_are_consistent", queriesAreConsistent},
		{"conveyed_power_is_what_a_delegation_contributes", conveyedPowerIsWhatADelegationContributes},
		{"positive_power_matches_stratum_one", positivePowerMatchesStratumOne},
		{"positive_power_is_monotone", positivePowerIsMonotone},
		{"listings_match_the_set", listingsMatchTheSet},
		{"closure_is_sufficient", closureIsSufficient},
		{"members_for_subset_answers_as_the_subset", membersForSubsetAnswersAsTheSubset},
		{"batches_equal_singles", batchesEqualSingles},
		{"interleaving_is_invisible", interleavingIsInvisible},
		{"members_of_matches_members", membersOfMatchesMembers},
		{"computed_parents_match_stored_edges", computedParentsMatchStoredEdges},
	} {
		t.Run(law.name, func(t *testing.T) { law.run(t, st, set, seed) })
	}
}

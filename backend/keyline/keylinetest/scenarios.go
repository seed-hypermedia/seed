//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"fmt"
	"slices"
	"sync"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// Keep test expectations and the threshold oracle independent of Power.Compare.
var powerOrder = []keyline.Power{keyline.None, keyline.Sync, keyline.Read, keyline.Write, keyline.Admin}

// These scenarios adapt Keyline's conformance/scenarios.rs (Apache-2.0), at
// the revision cited by the package, replacing signed certificates with facts.
func testEvaluationScenarios(t *testing.T, newStore NewStore) {
	tests := []struct {
		name        string
		delegations []keyline.Delegation
		revocations []keyline.Revocation
		powers      map[[2]keyline.Node]keyline.Power
		live        map[keyline.ID]bool
	}{
		// upstream: scenarios::empty_graph
		{
			name:   "empty graph and self authority",
			powers: map[[2]keyline.Node]keyline.Power{{"doc", "doc"}: keyline.Admin, {"doc", "alice"}: keyline.None, {"", ""}: keyline.None},
			live:   map[keyline.ID]bool{"missing": false},
		},
		// upstream: scenarios::attenuation_and_widest_path
		{
			name: "attenuation and widest route",
			delegations: []keyline.Delegation{
				{"a", "doc", "alice", "doc", keyline.Admin, 1},
				{"b", "alice", "bob", "doc", keyline.Read, 2},
				{"c", "bob", "carol", "doc", keyline.Admin, 3},
				{"d", "doc", "carol", "doc", keyline.Sync, 4},
				{"e", "doc", "dan", "doc", keyline.Sync, 5},
				{"f", "dan", "eve", "doc", keyline.Admin, 6},
			},
			powers: map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.Admin, {"doc", "bob"}: keyline.Read, {"doc", "carol"}: keyline.Read, {"doc", "eve"}: keyline.Sync, {"other", "alice"}: keyline.None},
			live:   map[keyline.ID]bool{"c": true, "f": true},
		},
		// upstream: scenarios::ungrounded_edges_are_dead
		{
			name: "ungrounded cycle and grounded cycle cannot amplify",
			delegations: []keyline.Delegation{
				{"a", "alice", "bob", "doc", keyline.Admin, 1},
				{"b", "bob", "alice", "doc", keyline.Admin, 2},
				{"c", "doc", "carol", "doc", keyline.Read, 3},
				{"d", "carol", "dan", "doc", keyline.Admin, 4},
				{"e", "dan", "carol", "doc", keyline.Admin, 5},
			},
			powers: map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.None, {"doc", "bob"}: keyline.None, {"doc", "carol"}: keyline.Read, {"doc", "dan"}: keyline.Read},
			live:   map[keyline.ID]bool{"a": false, "b": false, "d": true, "e": true},
		},
		// upstream: scenarios::membership_composes
		// upstream: scenarios::late_binding_grants_new_documents_to_members
		{
			name: "role membership composes and late bound documents inherit",
			delegations: []keyline.Delegation{
				{"a", "doc", "owners", "doc", keyline.Admin, 1},
				{"b", "owners", "bob", "owners", keyline.Admin, 2},
				{"c", "members", "owners", "members", keyline.Admin, 3},
				{"d", "bob", "members", "doc", keyline.Write, 4},
				{"e", "bob", "alice", "members", keyline.Read, 5},
				{"f", "other", "members", "other", keyline.Sync, 6},
			},
			powers: map[[2]keyline.Node]keyline.Power{{"doc", "bob"}: keyline.Admin, {"members", "bob"}: keyline.Admin, {"doc", "alice"}: keyline.Read, {"other", "alice"}: keyline.Sync},
		},
		// upstream: scenarios::issuer_revocation_is_total
		// upstream: scenarios::audience_revocation_without_admin_reach_is_total
		{
			name: "issuer and audience revocations are total without admin",
			delegations: []keyline.Delegation{
				{"a", "doc", "alice", "doc", keyline.Read, 1},
				{"b", "alice", "bob", "doc", keyline.Read, 2},
				{"c", "alice", "carol", "doc", keyline.Read, 3},
			},
			revocations: []keyline.Revocation{{"r1", "alice", "b", 4}, {"r2", "carol", "c", 5}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.Read, {"doc", "bob"}: keyline.None, {"doc", "carol"}: keyline.None},
			live:        map[keyline.ID]bool{"a": true, "b": false, "c": false},
		},
		// upstream: scenarios::covered_edges_are_clamped_not_just_gated
		{
			name: "covered edge is clamped to independent standing",
			delegations: []keyline.Delegation{
				{"a", "doc", "mods", "doc", keyline.Write, 1},
				{"b", "mods", "dan", "mods", keyline.Admin, 2},
				{"c", "dan", "eve", "mods", keyline.Admin, 3},
				{"d", "doc", "eve", "doc", keyline.Read, 4},
				{"h", "eve", "frank", "doc", keyline.Admin, 5},
			},
			revocations: []keyline.Revocation{{"r", "dan", "h", 6}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "eve"}: keyline.Write, {"doc", "frank"}: keyline.Read},
			live:        map[keyline.ID]bool{"h": true},
		},
		// upstream: scenarios::non_admin_revocation_is_confined_to_own_node
		{
			name: "non admin excludes own node inside role derivation",
			delegations: []keyline.Delegation{
				{"a", "doc", "mods", "doc", keyline.Write, 1},
				{"b", "mods", "dan", "mods", keyline.Write, 2},
				{"c", "dan", "eve", "mods", keyline.Write, 3},
				{"d", "mods", "eve", "mods", keyline.Read, 4},
				{"h", "eve", "frank", "doc", keyline.Admin, 5},
			},
			revocations: []keyline.Revocation{{"r", "dan", "h", 6}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "eve"}: keyline.Write, {"doc", "frank"}: keyline.Read, {"mods", "dan"}: keyline.Write},
			live:        map[keyline.ID]bool{"h": true},
		},
		// upstream: scenarios::mutually_covered_edges_cannot_lift_each_other
		{
			name: "mutually covered edges cannot bootstrap caps",
			delegations: []keyline.Delegation{
				{"a", "doc", "eve", "doc", keyline.Read, 1},
				{"b", "doc", "mods", "doc", keyline.Write, 2},
				{"c", "mods", "eve", "mods", keyline.Admin, 3},
				{"d", "doc", "mods2", "doc", keyline.Write, 4},
				{"e", "mods2", "frank", "mods2", keyline.Admin, 5},
				{"h1", "eve", "frank", "doc", keyline.Admin, 6},
				{"h2", "frank", "eve", "doc", keyline.Admin, 7},
				{"h3", "frank", "gus", "doc", keyline.Admin, 8},
			},
			revocations: []keyline.Revocation{{"r1", "mods", "h1", 9}, {"r2", "mods2", "h2", 10}, {"r3", "mods2", "h3", 11}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "eve"}: keyline.Write, {"doc", "frank"}: keyline.Write, {"doc", "gus"}: keyline.Read},
			live:        map[keyline.ID]bool{"h1": true, "h2": true, "h3": true},
		},
		// upstream: scenarios::role_admin_cannot_revoke_the_supply_into_the_role
		{
			name: "supply and roster have separate authority",
			delegations: []keyline.Delegation{
				{"a", "doc", "dan", "doc", keyline.Admin, 1},
				{"supply", "dan", "members", "doc", keyline.Write, 2},
				{"b", "members", "carol", "members", keyline.Admin, 3},
				{"roster", "carol", "alice", "members", keyline.Read, 4},
			},
			revocations: []keyline.Revocation{{"r1", "carol", "supply", 5}, {"r2", "dan", "roster", 6}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.Read},
			live:        map[keyline.ID]bool{"supply": true, "roster": true},
		},
		{
			name: "revoking supply preserves internal roster",
			delegations: []keyline.Delegation{
				{"a", "doc", "dan", "doc", keyline.Admin, 1},
				{"supply", "dan", "members", "doc", keyline.Write, 2},
				{"roster", "members", "alice", "members", keyline.Admin, 3},
			},
			revocations: []keyline.Revocation{{"r", "dan", "supply", 4}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.None, {"members", "alice"}: keyline.Admin},
			live:        map[keyline.ID]bool{"supply": false, "roster": true},
		},
		// upstream: scenarios::mutual_revocations_both_take_effect
		// upstream: scenarios::root_role_duel_kills_creation_memberships_even_when_edit_rooted
		{
			name: "mutual admin revocations both take effect",
			delegations: []keyline.Delegation{
				{"root", "doc", "owners", "doc", keyline.Write, 1},
				{"a", "owners", "alice", "owners", keyline.Admin, 2},
				{"b", "owners", "bob", "owners", keyline.Admin, 3},
			},
			revocations: []keyline.Revocation{{"r1", "alice", "b", 4}, {"r2", "bob", "a", 5}, {"r3", "alice", "root", 6}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.None, {"doc", "bob"}: keyline.None, {"doc", "owners"}: keyline.Write},
			live:        map[keyline.ID]bool{"root": true, "a": false, "b": false},
		},
		// upstream: scenarios::root_role_admin_can_revoke_the_root_edge
		{
			name: "composed admin reach can cut a root",
			delegations: []keyline.Delegation{
				{"root", "doc", "owners", "doc", keyline.Admin, 1},
				{"a", "owners", "alice", "owners", keyline.Admin, 2},
			},
			revocations: []keyline.Revocation{{"r", "alice", "root", 3}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.None, {"owners", "alice"}: keyline.Admin},
			live:        map[keyline.ID]bool{"root": false, "a": true},
		},
		// upstream: scenarios::unknown_revocation_is_inert
		{
			name: "unknown targets and unrelated revokers are inert",
			delegations: []keyline.Delegation{
				{"a", "doc", "alice", "doc", keyline.Write, 1},
			},
			revocations: []keyline.Revocation{{"r1", "alice", "missing", 2}, {"r2", "stranger", "a", 3}, {"r3", "doc", "r2", 4}},
			powers:      map[[2]keyline.Node]keyline.Power{{"doc", "alice"}: keyline.Write},
			live:        map[keyline.ID]bool{"a": true, "missing": false, "r2": false},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			facts := testFacts{tt.delegations, tt.revocations}
			store := facts.store(t, newStore)
			e := testQueries{t, store}
			for q, want := range tt.powers {
				require.Equal(t, want, e.EffectivePower(q[0], q[1]), "query %v", q)
				for i, required := range powerOrder[1:] {
					require.Equal(t, slices.Index(powerOrder, want) > i, e.Allows(q[0], q[1], required), "query %v at %v", q, required)
				}
			}

			for id, want := range tt.live {
				require.Equal(t, want, e.IsLive(id), "delegation %s", id)
			}

			require.False(t, e.Allows("doc", "doc", keyline.None))
			require.False(t, e.Allows("doc", "doc", keyline.Admin+1))
			require.NotContains(t, e.Members("doc"), keyline.Node("doc"))
		})
	}
}

// TestWriteRootedRootEdgeIsIrrevocable ports edit_rooted_root_edge_is_irrevocable.
// The transition scenarios below adapt Keyline's Apache-2.0 conformance tests:
// keyline/src/test_utils/conformance/scenarios.rs at the commit pinned in ../UPSTREAM.
// Signed certificate reissues become fresh opaque fact IDs.
// upstream: scenarios::edit_rooted_root_edge_is_irrevocable
func testWriteRootedRootEdgeIsIrrevocable(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Write, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"carol-owner", "owners", "carol", "owners", keyline.Admin, 3},
		{"members-root", "members", "owners", "members", keyline.Admin, 4},
		{"supply", "bob", "members", "doc", keyline.Write, 5},
		{"alice-member", "carol", "alice", "members", keyline.Admin, 6},
	}}
	store := facts.store(t, newStore)
	q := testQueries{t, store}
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "bob"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "bob"))

	_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-root", "bob", "root", 7}}})
	require.NoError(t, err)
	require.True(t, q.IsLive("root"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "bob"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "bob"), "Write-rooting preserves junior-role governance")

	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-member", "bob", "alice-member", 8}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("alice-member"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.None, q.EffectivePower("members", "alice"))
	require.True(t, q.IsLive("root"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "bob"))
}

// TestSeniorRoleAdminRevokesInsideJuniorRole ports senior_role_admin_revokes_inside_junior_role.
// upstream: scenarios::senior_role_admin_revokes_inside_junior_role
func testSeniorRoleAdminRevokesInsideJuniorRole(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"members-root", "members", "dan", "members", keyline.Admin, 3},
		{"owners-admin", "dan", "owners", "members", keyline.Admin, 4},
		{"supply", "bob", "members", "doc", keyline.Write, 5},
		{"alice-member", "dan", "alice", "members", keyline.Admin, 6},
	}}
	store := facts.store(t, newStore)
	q := testQueries{t, store}
	// Bob's Members authority composes through Owners, whose Admin
	// grant is an ordinary edge issued by Dan, not a root edge.
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "bob"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.True(t, q.IsLive("alice-member"))

	_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-member", "bob", "alice-member", 7}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("alice-member"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.None, q.EffectivePower("members", "alice"))
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "dan"))
	require.True(t, q.IsLive("supply"))
}

// TestSupplyIsDaisyChained ports supply_is_daisy_chained.
// upstream: scenarios::supply_is_daisy_chained
func testSupplyIsDaisyChained(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"mods-supply", "bob", "mods", "doc", keyline.Admin, 3},
		{"dan-mod", "mods", "dan", "mods", keyline.Admin, 4},
		{"supply", "dan", "members", "doc", keyline.Write, 5},
		{"members-root", "members", "carol", "members", keyline.Admin, 6},
		{"alice-member", "carol", "alice", "members", keyline.Admin, 7},
	}}
	store := facts.store(t, newStore)
	q := testQueries{t, store}
	require.Equal(t, keyline.Admin, q.EffectivePower("doc", "dan"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "members"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.None, q.EffectivePower("members", "dan"))

	_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-roster", "dan", "alice-member", 8}}})
	require.NoError(t, err)
	require.True(t, q.IsLive("alice-member"), "Members' roster never routes through Dan")
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))

	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-supply", "dan", "supply", 9}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("supply"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "members"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "carol"))
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "alice"))
	require.True(t, q.IsLive("alice-member"))
	require.Equal(t, keyline.Admin, q.EffectivePower("doc", "dan"))
}

// TestGiftCertAttackFollowsLiveness ports gift_cert_attack_follows_liveness.
// upstream: scenarios::gift_cert_attack_follows_liveness
func testGiftCertAttackFollowsLiveness(t *testing.T, newStore NewStore) {
	rungs := []keyline.Node{"rung-0", "rung-1", "rung-2", "rung-3"}
	top, bottom := rungs[0], rungs[len(rungs)-1]
	eveMember := keyline.Delegation{"eve-member", "bob", "eve", "doc", keyline.Write, 4}
	gift := keyline.Delegation{"gift", "eve", "alice", bottom, keyline.Admin, 20}
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"alice-read", "bob", "alice", "doc", keyline.Read, 3},
		eveMember,
		{"supply", "eve", top, "doc", keyline.Write, 5},
	}}
	for i, rung := range rungs {
		facts.Delegations = append(facts.Delegations, keyline.Delegation{keyline.ID("root-" + rung), rung, "eve", rung, keyline.Admin, int64(6 + 2*i)})
		if i+1 < len(rungs) {
			facts.Delegations = append(facts.Delegations, keyline.Delegation{keyline.ID("inner-" + rung), "eve", rungs[i+1], rung, keyline.Admin, int64(7 + 2*i)})
		}
	}

	for _, branch := range []string{"fresh_key_and_resupply", "same_key_and_regift"} {
		t.Run(branch, func(t *testing.T) {
			store := facts.store(t, newStore)
			q := testQueries{t, store}
			require.Equal(t, keyline.Write, q.EffectivePower("doc", bottom))
			require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))

			// A gift raises Alice's authority without an acceptance fact.
			changed, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{gift}})
			require.NoError(t, err)
			require.True(t, changed)
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))

			_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"remove-eve", "bob", eveMember.ID, 21}}})
			require.NoError(t, err)
			require.Equal(t, keyline.None, q.EffectivePower("doc", "eve"))
			require.False(t, q.IsLive(eveMember.ID))
			require.False(t, q.IsLive("supply"))
			require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))
			members := q.Members("doc")
			for _, rung := range rungs {
				require.NotContains(t, members, rung)
			}

			// Role-local internals stay grounded after losing Doc access.
			require.True(t, q.IsLive("inner-rung-0"))
			require.True(t, q.IsLive(gift.ID))
			require.Equal(t, keyline.Admin, q.EffectivePower(top, "alice"))

			if branch == "fresh_key_and_resupply" {
				_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"frank-member", "bob", "frank", "doc", keyline.Write, 22}}})
				require.NoError(t, err)
				require.Equal(t, keyline.Write, q.EffectivePower("doc", "frank"))
				require.Equal(t, keyline.None, q.EffectivePower("doc", "eve"))
				require.False(t, q.IsLive("supply"), "a fresh key does not revive the old key's supply")
				require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))

				// Resupplying the same ladder regrounds Eve through her
				// Admin seat, so even her original supply revives.
				_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"fresh-supply", "frank", top, "doc", keyline.Write, 23}}})
				require.NoError(t, err)
				require.Equal(t, keyline.Write, q.EffectivePower("doc", "eve"))
				require.False(t, q.IsLive(eveMember.ID))
				require.True(t, q.IsLive("supply"))
				require.True(t, q.IsLive(gift.ID))
				require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
				return
			}

			// Same node, fresh fact ID: the old downstream facts revive.
			reissuedMember := eveMember
			reissuedMember.ID, reissuedMember.BlobID = "eve-member-reissued", 22
			_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{reissuedMember}})
			require.NoError(t, err)
			require.False(t, q.IsLive(eveMember.ID))
			require.True(t, q.IsLive(reissuedMember.ID))
			require.True(t, q.IsLive("supply"))
			require.True(t, q.IsLive(gift.ID))
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))

			_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"reject-gift", "alice", gift.ID, 23}}})
			require.NoError(t, err)
			require.False(t, q.IsLive(gift.ID))
			require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))
			require.Equal(t, keyline.Write, q.EffectivePower("doc", bottom))

			// Replaying the identical gift preserves its revocation.
			changed, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{gift}})
			require.NoError(t, err)
			require.False(t, changed)
			require.False(t, q.IsLive(gift.ID))
			require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))
			require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
				var revocations []keyline.ID

				for r, err := range tx.Revocations(t.Context(), gift.ID) {
					require.NoError(t, err)
					revocations = append(revocations, r.ID)
				}

				require.Equal(t, []keyline.ID{"reject-gift"}, revocations)
				return nil
			}))

			// A fresh gift ID needs its own audience revocation.
			regift := gift
			regift.ID, regift.BlobID = "regift", 24
			changed, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{regift}})
			require.NoError(t, err)
			require.True(t, changed)
			require.True(t, q.IsLive(regift.ID))
			require.False(t, q.IsLive(gift.ID))
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
			_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"reject-regift", "alice", regift.ID, 25}}})
			require.NoError(t, err)
			require.False(t, q.IsLive(regift.ID))
			require.Equal(t, keyline.Read, q.EffectivePower("doc", "alice"))
		})
	}
}

// TestPinnedDelegationAnswersToTheRole ports pinned_delegation_answers_to_the_role.
// upstream: scenarios::pinned_delegation_answers_to_the_role
func testPinnedDelegationAnswersToTheRole(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"carol-owner", "owners", "carol", "owners", keyline.Admin, 3},
		{"members-root", "members", "owners", "members", keyline.Admin, 4},
		{"supply", "bob", "members", "doc", keyline.Write, 5},
		{"alice-member", "carol", "alice", "members", keyline.Admin, 6},
		{"independent", "bob", "alice", "doc", keyline.Write, 7},
		{"pin-root", "pin", "alice", "pin", keyline.Admin, 8},
		{"pinned", "alice", "pin", "members", keyline.Write, 9},
		{"eve-access", "alice", "eve", "pin", keyline.Write, 10},
	}}
	for _, revocation := range []keyline.Revocation{
		{"remove-member", "carol", "alice-member", 11},
		{"cut-pin", "bob", "pinned", 11},
	} {
		t.Run(string(revocation.ID), func(t *testing.T) {
			store := facts.store(t, newStore)
			q := testQueries{t, store}
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "eve"))
			require.True(t, q.IsLive("pinned"))
			require.Equal(t, keyline.Admin, q.EffectivePower("members", "alice"))

			_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{revocation}})
			require.NoError(t, err)
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"), "Alice keeps her independent route")
			require.True(t, q.IsLive("independent"))
			require.False(t, q.IsLive("pinned"))
			require.Equal(t, keyline.None, q.EffectivePower("doc", "eve"))
			require.True(t, q.IsLive("eve-access"), "the pin's own roster stays grounded")
			require.Equal(t, keyline.Write, q.EffectivePower("pin", "eve"))

			if revocation.Target == "alice-member" {
				require.Equal(t, keyline.None, q.EffectivePower("members", "alice"))
			} else {
				require.Equal(t, keyline.Admin, q.EffectivePower("members", "alice"), "a Members admin can cut the pin without removing Alice")
			}
		})
	}
}

// TestCaretakerAdminSeversDownstreamButNotTheSupply ports caretaker_admin_severs_downstream_but_not_the_supply.
// upstream: scenarios::caretaker_admin_severs_downstream_but_not_the_supply
func testCaretakerAdminSeversDownstreamButNotTheSupply(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"bob-owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"members-root", "members", "owners", "members", keyline.Admin, 3},
		{"members-supply", "bob", "members", "doc", keyline.Write, 4},
		{"supply", "bob", "caretaker", "members", keyline.Write, 5},
		{"dan-admin", "caretaker", "dan", "caretaker", keyline.Admin, 6},
		{"carol-roster", "caretaker", "carol", "caretaker", keyline.Write, 7},
	}}
	store := facts.store(t, newStore)
	q := testQueries{t, store}
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "carol"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "dan"))
	require.Equal(t, keyline.Write, q.EffectivePower("members", "dan"))
	require.Equal(t, keyline.Admin, q.EffectivePower("caretaker", "dan"))

	_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-supply", "dan", "supply", 8}}})
	require.NoError(t, err)
	require.True(t, q.IsLive("supply"), "the supply's audience is not on its grounding route")
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "carol"))

	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"revoke-roster", "dan", "carol-roster", 9}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("carol-roster"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "carol"))
	require.Equal(t, keyline.None, q.EffectivePower("members", "carol"))
	require.True(t, q.IsLive("supply"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "dan"))
}

// upstream: scenarios::revocations_of_one_delegation_cover_jointly
func testRevocationCoverageUnion(t *testing.T, newStore NewStore) {
	base := testFacts{Delegations: []keyline.Delegation{
		{"a", "doc", "mods", "doc", keyline.Write, 1},
		{"b", "mods", "dan", "mods", keyline.Admin, 2},
		{"c", "dan", "eve", "mods", keyline.Admin, 3},
		{"d", "doc", "members", "doc", keyline.Read, 4},
		{"e", "members", "carol", "members", keyline.Admin, 5},
		{"f", "carol", "eve", "members", keyline.Admin, 6},
		{"h", "eve", "frank", "doc", keyline.Admin, 7},
	}}
	for _, tt := range []struct {
		revokers []keyline.Node
		want     keyline.Power
	}{
		{nil, keyline.Write},
		{[]keyline.Node{"dan"}, keyline.Read},
		{[]keyline.Node{"carol"}, keyline.Write},
		{[]keyline.Node{"dan", "carol"}, keyline.None},
	} {
		t.Run(fmt.Sprint(tt.revokers), func(t *testing.T) {
			s := base
			for _, issuer := range tt.revokers {
				s.Revocations = append(s.Revocations, keyline.Revocation{keyline.ID(issuer), issuer, "h", 8})
			}

			e := testQueries{t, s.store(t, newStore)}
			require.Equal(t, tt.want, e.EffectivePower("doc", "frank"))
			require.Equal(t, tt.want != keyline.None, e.IsLive("h"))
			require.Equal(t, keyline.Write, e.EffectivePower("doc", "eve"))
		})
	}
}

// upstream: scenarios::ex_admin_reach_is_frozen
// upstream: scenarios::reissue_with_citation_heals
func testReissueAndFormerAdmin(t *testing.T, newStore NewStore) {
	store := newStore(t)
	_, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Write, 1},
		{"a", "owners", "alice", "owners", keyline.Admin, 2},
		{"b", "owners", "bob", "owners", keyline.Admin, 3},
		{"child", "alice", "carol", "doc", keyline.Write, 4},
	}})
	require.NoError(t, err)

	q := testQueries{t, store}
	require.True(t, q.Allows("doc", "carol", keyline.Write))
	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"r", "bob", "a", 5}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("child"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "carol"))

	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"a2", "owners", "alice", "owners", keyline.Admin, 6}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("a"))
	require.True(t, q.IsLive("a2"))
	require.True(t, q.IsLive("child"), "the original downstream delegation revives")
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "carol"))

	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"r2", "bob", "a2", 7}}})
	require.NoError(t, err)
	// Alice is removed again but still has positive-graph Admin reach over Owners.
	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"r3", "alice", "b", 8}}})
	require.NoError(t, err)
	require.Equal(t, map[keyline.Node]keyline.Power{"owners": keyline.Write}, q.Members("doc"))
}

func testOldRevocationGainsCoverage(t *testing.T, newStore NewStore) {
	store := newStore(t)
	_, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Write, 1}}})
	require.NoError(t, err)
	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"r", "bob", "a", 2}}})
	require.NoError(t, err)
	q := testQueries{t, store}
	require.True(t, q.IsLive("a"))
	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"b", "doc", "bob", "doc", keyline.Admin, 3}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("a"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
}

// upstream: scenarios::insert_is_idempotent_and_reports_duplicates
func testStoreIdentityAndIsolation(t *testing.T, newStore NewStore) {
	store := newStore(t)
	d := keyline.Delegation{"a", "doc", "alice", "doc", keyline.Read, 1}
	r := keyline.Revocation{"r", "alice", "a", 2}
	inserted, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{d}})
	require.NoError(t, err)
	require.True(t, inserted)
	inserted, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{d}})
	require.NoError(t, err)
	require.False(t, inserted)
	bad := d
	bad.Power = keyline.Admin
	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{bad}})
	require.ErrorIs(t, err, keyline.ErrConflict)
	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{d.ID, "alice", "a", 3}}})
	require.ErrorIs(t, err, keyline.ErrConflict)
	inserted, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{r}})
	require.NoError(t, err)
	require.True(t, inserted)
	inserted, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{r}})
	require.NoError(t, err)
	require.False(t, inserted)
	_, err = store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{r.ID, "bob", "a", 2}}})
	require.ErrorIs(t, err, keyline.ErrConflict)
	bad.ID = r.ID
	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{bad}})
	require.ErrorIs(t, err, keyline.ErrConflict)

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		got, found, err := tx.Delegation(t.Context(), d.ID)
		require.NoError(t, err)
		require.True(t, found)
		require.Equal(t, d, got)
		got.Audience = "mallory"
		return nil
	}))
	e := testQueries{t, store}
	require.Empty(t, e.Members("doc"))
	require.False(t, e.IsLive("a"))

	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{{"b", "doc", "bob", "doc", keyline.Read, 4}}})
	require.NoError(t, err)
	members := e.Members("doc")
	members["bob"] = keyline.Admin
	require.Equal(t, keyline.Read, e.EffectivePower("doc", "bob"))
}

func testInvalidFacts(t *testing.T, newStore NewStore) {
	for _, facts := range []testFacts{
		{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.None, 1}}},
		{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Admin + 1, 1}}},
		{Delegations: []keyline.Delegation{{"a", "", "alice", "doc", keyline.Read, 1}}},
		{Delegations: []keyline.Delegation{{"a", "doc", "", "doc", keyline.Read, 1}}},
		{Delegations: []keyline.Delegation{{"a", "doc", "alice", "", keyline.Read, 1}}},
		{Delegations: []keyline.Delegation{{"", "doc", "alice", "doc", keyline.Read, 1}}},
		{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Read, 1}, {"a", "doc", "bob", "doc", keyline.Read, 2}}},
		{Revocations: []keyline.Revocation{{"", "alice", "a", 1}}},
		{Revocations: []keyline.Revocation{{"r", "", "a", 1}}},
		{Revocations: []keyline.Revocation{{"r", "alice", "", 1}}},
		{Revocations: []keyline.Revocation{{"r", "alice", "a", 1}, {"r", "bob", "a", 2}}},
		{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Read, 1}}, Revocations: []keyline.Revocation{{"a", "alice", "a", 2}}},
	} {
		store := newStore(t)
		changed, err := store.Apply(t.Context(), keyline.Batch{Delegations: facts.Delegations, Revocations: facts.Revocations})
		require.Error(t, err)
		require.False(t, changed)
	}
}

func testConcurrentStore(t *testing.T, newStore NewStore) {
	store := newStore(t)
	errs := make(chan error, 8)
	var wg sync.WaitGroup

	for i := range 8 {
		wg.Go(func() {
			d := keyline.Delegation{keyline.ID(fmt.Sprint(i)), "doc", keyline.Node(fmt.Sprint(i)), "doc", keyline.Read, int64(i + 1)}

			_, err := store.Apply(t.Context(), keyline.Batch{Delegations: []keyline.Delegation{d}})
			if err != nil {
				errs <- err
				return
			}

			err = store.View(t.Context(), func(tx keyline.ReadTx) error {
				allowed, err := keyline.Allows(t.Context(), tx, "doc", d.Audience, keyline.Read)
				if err != nil {
					return err
				}

				if !allowed {
					return fmt.Errorf("missing authority after inserting %s", d.ID)
				}

				return nil
			})

			errs <- err
		})
	}

	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	e := testQueries{t, store}
	require.Len(t, e.Members("doc"), 8)
}

// Confirm insertion order and replay cannot affect results. Duplicate iterator
// rows are exercised separately in TestDuplicateIteratorRows.
func testSetSemantics(t *testing.T, newStore NewStore) {
	s := testFacts{Delegations: []keyline.Delegation{
		{"a", "doc", "alice", "doc", keyline.Write, 1},
		{"b", "alice", "bob", "doc", keyline.Admin, 2},
	}}
	first := testQueries{t, s.store(t, newStore)}
	s.Delegations = append(s.Delegations, s.Delegations...)
	slices.Reverse(s.Delegations)
	second := testQueries{t, s.store(t, newStore)}
	require.Equal(t, first.Members("doc"), second.Members("doc"))
}

type testFacts struct {
	Delegations []keyline.Delegation
	Revocations []keyline.Revocation
}

// upstream: scenarios::revocation_may_arrive_before_its_target
func (s testFacts) store(t testing.TB, newStore NewStore) keyline.Store {
	t.Helper()
	store := newStore(t)
	// Keep exercising arrival before targets as well as atomic insertion.
	_, err := store.Apply(t.Context(), keyline.Batch{Revocations: s.Revocations})
	require.NoError(t, err)
	_, err = store.Apply(t.Context(), keyline.Batch{Delegations: s.Delegations})
	require.NoError(t, err)
	return store
}

// testQueries keeps scenario assertions readable while exercising public queries
// through fresh read transactions and requiring every storage error to be checked.
type testQueries struct {
	t     *testing.T
	store keyline.Store
}

func readTest[T any](t *testing.T, store keyline.Store, fn func(keyline.ReadTx) (T, error)) T {
	t.Helper()
	var value T

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		value, err = fn(tx)
		return err
	}))
	return value
}

func (q testQueries) EffectivePower(subject, audience keyline.Node) keyline.Power {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (keyline.Power, error) {
		return keyline.EffectivePower(q.t.Context(), tx, subject, audience)
	})
}

func (q testQueries) Allows(subject, audience keyline.Node, required keyline.Power) bool {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (bool, error) {
		return keyline.Allows(q.t.Context(), tx, subject, audience, required)
	})
}

func (q testQueries) IsLive(id keyline.ID) bool {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (bool, error) {
		return keyline.IsLive(q.t.Context(), tx, id)
	})
}

func (q testQueries) Members(subject keyline.Node) map[keyline.Node]keyline.Power {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (map[keyline.Node]keyline.Power, error) {
		return keyline.Members(q.t.Context(), tx, subject)
	})
}

//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"fmt"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// These scenarios adapt Keyline's rotation contracts (Apache-2.0, revision in
// keyline.go). Applications supply fresh identities and authenticated batches;
// rotation adds facts rather than rewriting nodes or downstream delegations.
// upstream: scenarios::rotation_escapes_frozen_reach
func testRotationEscapesFrozenReach(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"root", "doc", "owners", "doc", keyline.Admin, 1},
		{"owner", "owners", "bob", "owners", keyline.Admin, 2},
		{"supply", "bob", "members", "doc", keyline.Write, 3},
		{"dan", "members", "dan", "members", keyline.Admin, 4},
		{"alice", "members", "alice", "members", keyline.Admin, 5},
	}}
	store := facts.store(t, newStore)
	ctx := t.Context()
	q := testQueries{t, store}
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "dan"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	_, err := store.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{{"ban-alice", "dan", "alice", 6}}})
	require.NoError(t, err)
	require.False(t, q.IsLive("alice"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))

	rotation := keyline.Batch{
		Nodes: []keyline.NodeRecord{{"members-next", 7, 0, "next-blob"}},
		Delegations: []keyline.Delegation{
			{"next-owner", "members-next", "bob", "members-next", keyline.Admin, 8},
			{"next-supply", "bob", "members-next", "doc", keyline.Write, 9},
			{"next-alice", "bob", "alice", "members-next", keyline.Admin, 10},
		},
		Revocations: []keyline.Revocation{{"retire-supply", "bob", "supply", 11}},
	}
	before := readDigest(t, store)
	// A conflict at the end must not install the fresh node or any of
	// its roster, or revoke the old supply.
	invalid := rotation
	invalid.Revocations = []keyline.Revocation{rotation.Revocations[0], {"root", "bob", "supply", 12}}
	changed, err := store.Apply(ctx, invalid)
	require.ErrorIs(t, err, keyline.ErrConflict)
	require.False(t, changed)
	require.Equal(t, before, readDigest(t, store))
	require.True(t, q.IsLive("supply"))
	require.False(t, q.IsLive("next-supply"))
	require.Equal(t, keyline.None, q.EffectivePower("members-next", "bob"))
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		_, found, err := tx.Node(ctx, "members-next")
		require.NoError(t, err)
		require.False(t, found)
		return nil
	}))

	changed, err = store.Apply(ctx, rotation)
	require.NoError(t, err)
	require.True(t, changed)
	require.NotEqual(t, before, readDigest(t, store))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.None, q.EffectivePower("doc", "dan"))
	require.False(t, q.IsLive("supply"))
	changed, err = store.Apply(ctx, rotation)
	require.NoError(t, err)
	require.False(t, changed, "replaying rotation must not mint another identity")

	_, err = store.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{
		{"attack-roster", "dan", "next-alice", 13},
		{"attack-supply", "dan", "next-supply", 14},
	}})
	require.NoError(t, err)
	require.True(t, q.IsLive("next-alice"))
	require.True(t, q.IsLive("next-supply"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.False(t, q.IsLive("alice"), "Dan's original revocation still covers the old roster")
	require.Equal(t, keyline.Admin, q.EffectivePower("members", "dan"), "the abandoned roster is dormant, not erased")
}

// upstream: scenarios::steward_rotation_leaves_former_officers_nothing
func testStewardRotationLeavesFormerOfficersNothing(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"doc-root", "doc", "steward", "doc", keyline.Write, 1},
		{"other-root", "other-doc", "steward", "other-doc", keyline.Write, 2},
		{"officers-supply", "steward", "officers", "steward", keyline.Write, 3},
		{"alice", "officers", "alice", "officers", keyline.Admin, 4},
		{"bob", "officers", "bob", "officers", keyline.Admin, 5},
		{"carol", "alice", "carol", "doc", keyline.Admin, 6},
		{"dan", "bob", "dan", "other-doc", keyline.Write, 7},
	}}
	store := facts.store(t, newStore)
	ctx := t.Context()
	q := testQueries{t, store}
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "alice"))
	require.Equal(t, keyline.Write, q.EffectivePower("other-doc", "bob"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "carol"))
	require.Equal(t, keyline.Write, q.EffectivePower("steward", "alice"))

	_, err := store.Apply(ctx, keyline.Batch{
		Nodes: []keyline.NodeRecord{{"officers-next", 8, 0, "next-blob"}},
		Delegations: []keyline.Delegation{
			{"next-supply", "steward", "officers-next", "steward", keyline.Write, 9},
			{"next-bob", "officers-next", "bob", "officers-next", keyline.Admin, 10},
		},
		Revocations: []keyline.Revocation{{"retire-officers", "steward", "officers-supply", 11}},
	})
	require.NoError(t, err)
	for _, subject := range []keyline.Node{"doc", "other-doc", "steward"} {
		require.Equal(t, keyline.None, q.EffectivePower(subject, "alice"), "subject %s", subject)
		require.Equal(t, keyline.Write, q.EffectivePower(subject, "bob"), "subject %s", subject)
	}

	require.Equal(t, keyline.None, q.EffectivePower("doc", "carol"))
	require.False(t, q.IsLive("carol"), "delegations from the removed officer lose their grounding")
	require.True(t, q.IsLive("dan"), "a survivor's downstream certificate keeps its identity")
	require.Equal(t, keyline.Write, q.EffectivePower("other-doc", "dan"))

	_, err = store.Apply(ctx, keyline.Batch{
		Delegations: []keyline.Delegation{
			{"late-carol", "alice", "carol", "other-doc", keyline.Write, 12},
			{"late-root", "late-doc", "steward", "late-doc", keyline.Write, 13},
		},
		Revocations: []keyline.Revocation{
			{"attack-supply", "alice", "next-supply", 14},
			{"attack-roster", "alice", "next-bob", 15},
			{"attack-root", "alice", "doc-root", 16},
			{"attack-downstream", "alice", "dan", 17},
		},
	})
	require.NoError(t, err)
	for _, id := range []keyline.ID{"next-supply", "next-bob", "doc-root", "dan"} {
		require.True(t, q.IsLive(id), "late hostile revocation of %s", id)
	}

	require.Equal(t, keyline.Write, q.EffectivePower("other-doc", "bob"))
	require.Equal(t, keyline.None, q.EffectivePower("other-doc", "carol"))
	require.Equal(t, keyline.Write, q.EffectivePower("late-doc", "bob"))
	require.Equal(t, keyline.None, q.EffectivePower("late-doc", "alice"))
	require.False(t, q.IsLive("late-carol"))
	require.True(t, q.IsLive("alice"), "the old roster remains self-grounded")
}

// upstream: scenarios::admin_reach_covers_a_transited_node
func testRotationRevocationContinuity(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"supply", "doc", "members", "doc", keyline.Write, 1},
		{"alice", "members", "alice", "members", keyline.Admin, 2},
		{"bob", "members", "bob", "members", keyline.Admin, 3},
		{"carol", "members", "carol", "members", keyline.Admin, 4},
		{"dave", "carol", "dave", "doc", keyline.Write, 5},
		{"eve", "carol", "eve", "doc", keyline.Write, 6},
		{"frank", "carol", "frank", "doc", keyline.Write, 7},
		{"gus", "carol", "gus", "doc", keyline.Write, 8},
	}, Revocations: []keyline.Revocation{
		{"bob-ban", "bob", "dave", 9},
		{"alice-ban", "alice", "eve", 10},
		{"audience-drop", "gus", "gus", 11},
	}}
	store := facts.store(t, newStore)
	ctx := t.Context()
	q := testQueries{t, store}
	for _, id := range []keyline.ID{"dave", "eve", "gus"} {
		require.False(t, q.IsLive(id), "before rotation: %s", id)
	}

	require.True(t, q.IsLive("frank"))
	_, err := store.Apply(ctx, keyline.Batch{
		Nodes: []keyline.NodeRecord{{"members-next", 12, 0, "next-blob"}},
		Delegations: []keyline.Delegation{
			{"next-supply", "doc", "members-next", "doc", keyline.Write, 13},
			{"next-bob", "members-next", "bob", "members-next", keyline.Admin, 14},
			{"next-carol", "members-next", "carol", "members-next", keyline.Admin, 15},
		},
		Revocations: []keyline.Revocation{{"retire-supply", "doc", "supply", 16}},
	})
	require.NoError(t, err)
	require.False(t, q.IsLive("dave"), "Bob's existing ban follows his successor Admin membership")
	require.Equal(t, keyline.None, q.EffectivePower("doc", "dave"))
	require.True(t, q.IsLive("eve"), "Alice's third-party ban no longer covers Carol's route")
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "eve"))
	require.True(t, q.IsLive("frank"))
	require.Equal(t, keyline.Write, q.EffectivePower("doc", "frank"))
	require.False(t, q.IsLive("gus"), "audience revocations remain total across rotation")
	require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
	// No downstream delegation or old revocation was replaced.
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		for _, want := range facts.Delegations[4:] {
			got, found, err := tx.Delegation(ctx, want.ID)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, want, got)
		}

		for _, want := range facts.Revocations {
			got, found, err := tx.Revocation(ctx, want.ID)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, want, got)
		}

		return nil
	}))

	_, err = store.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{
		{"late-alice-ban", "alice", "frank", 17},
		{"renew-eve-ban", "bob", "eve", 18},
	}})
	require.NoError(t, err)
	require.True(t, q.IsLive("frank"), "the removed admin cannot follow the successor")
	require.False(t, q.IsLive("eve"), "survivors must reissue removed admins' bans worth keeping")
	require.False(t, q.IsLive("dave"), "the survivor's original revocation needs no reissue")
}

func testRotationCannotEscapeSubjectAdmin(t *testing.T, newStore NewStore) {
	for _, oldPower := range []keyline.Power{keyline.Write, keyline.Admin} {
		t.Run(fmt.Sprint(oldPower), func(t *testing.T) {
			facts := testFacts{Delegations: []keyline.Delegation{
				{"supply", "doc", "members", "doc", oldPower, 1},
				{"alice", "members", "alice", "members", keyline.Admin, 2},
				{"bob", "members", "bob", "members", keyline.Admin, 3},
			}}
			store := facts.store(t, newStore)
			ctx := t.Context()
			q := testQueries{t, store}
			require.Equal(t, oldPower, q.EffectivePower("doc", "alice"))
			_, err := store.Apply(ctx, keyline.Batch{
				Nodes: []keyline.NodeRecord{{"members-next", 4, 0, "next-blob"}},
				Delegations: []keyline.Delegation{
					{"next-supply", "doc", "members-next", "doc", keyline.Write, 5},
					{"next-bob", "members-next", "bob", "members-next", keyline.Admin, 6},
				},
				Revocations: []keyline.Revocation{
					{"retire-supply", "doc", "supply", 7},
					{"remove-alice", "bob", "alice", 8},
				},
			})
			require.NoError(t, err)
			require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
			require.Equal(t, keyline.None, q.EffectivePower("members", "alice"))
			require.Equal(t, keyline.Write, q.EffectivePower("doc", "bob"))
			require.Equal(t, oldPower, readTest(t, store, func(tx keyline.ReadTx) (keyline.Power, error) {
				return keyline.PositivePower(ctx, tx, "doc", "alice")
			}), "removal does not shrink positive reach over the stable subject")

			_, err = store.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{
				{"attack-supply", "alice", "next-supply", 9},
				{"attack-roster", "alice", "next-bob", 10},
			}})
			require.NoError(t, err)
			require.True(t, q.IsLive("next-bob"), "Admin over doc does not imply Admin over the new role")
			require.Equal(t, keyline.Admin, q.EffectivePower("members-next", "bob"))

			if oldPower == keyline.Admin {
				require.False(t, q.IsLive("next-supply"), "doc remains in the ex-admin's positive reach forever")
				require.Equal(t, keyline.None, q.EffectivePower("doc", "bob"))
			} else {
				require.True(t, q.IsLive("next-supply"), "Write over the stable subject is the safe control")
				require.Equal(t, keyline.Write, q.EffectivePower("doc", "bob"))
			}
		})
	}
}

func testRotationClosureReplica(t *testing.T, newStore NewStore) {
	facts := testFacts{Delegations: []keyline.Delegation{
		{"supply", "doc", "members", "doc", keyline.Write, 1},
		{"alice", "members", "alice", "members", keyline.Admin, 2},
		{"bob", "members", "bob", "members", keyline.Admin, 3},
		{"carol", "bob", "carol", "doc", keyline.Write, 4},
		{"unrelated", "other-doc", "outsider", "other-doc", keyline.Admin, 5},
	}, Revocations: []keyline.Revocation{{"alice-ban", "alice", "carol", 6}}}
	ctx := t.Context()
	source, replica := facts.store(t, newStore), newStore(t)

	_, err := source.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"doc", 7, 0, "doc-blob"}, {"members", 8, 0, "members-blob"}, {"other-doc", 9, 0, "other-blob"}}})
	require.NoError(t, err)
	q, copyQ := testQueries{t, source}, testQueries{t, replica}
	for _, stage := range []string{"before", "rotated", "late revocations"} {
		switch stage {
		case "rotated":
			_, err := source.Apply(ctx, keyline.Batch{
				Nodes: []keyline.NodeRecord{{"members-next", 10, 0, "next-blob"}},
				Delegations: []keyline.Delegation{
					{"next-supply", "doc", "members-next", "doc", keyline.Write, 11},
					{"next-bob", "members-next", "bob", "members-next", keyline.Admin, 12},
				},
				Revocations: []keyline.Revocation{{"retire-supply", "doc", "supply", 13}},
			})
			require.NoError(t, err)
			require.Equal(t, keyline.None, q.EffectivePower("doc", "alice"))
			require.Equal(t, keyline.Write, copyQ.EffectivePower("doc", "alice"), "an unsynced replica cannot know the removal")
		case "late revocations":
			_, err := source.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{
				{"attack-supply", "alice", "next-supply", 14},
				{"attack-roster", "alice", "next-bob", 15},
				{"renew-ban", "bob", "carol", 16},
			}})
			require.NoError(t, err)
		}

		batch := readTest(t, source, func(tx keyline.ReadTx) (keyline.Batch, error) {
			return keyline.Collect(keyline.Closure(ctx, tx, "doc"))
		})
		// Simulate deterministic receiver-local blob indexing. A real
		// receiver authenticates the source blobs and looks up its IDs.
		for i := range batch.Nodes {
			batch.Nodes[i].BlobID += 1000
		}

		for i := range batch.Delegations {
			batch.Delegations[i].BlobID += 1000
		}

		for i := range batch.Revocations {
			batch.Revocations[i].BlobID += 1000
		}

		changed, err := replica.Apply(ctx, batch)
		require.NoError(t, err)
		require.True(t, changed)
		changed, err = replica.Apply(ctx, batch)
		require.NoError(t, err)
		require.False(t, changed)
		require.Equal(t, q.Members("doc"), copyQ.Members("doc"))
		require.Equal(t, stage == "rotated", copyQ.IsLive("carol"), "old and renewed bans must survive export")

		if stage != "before" {
			require.True(t, copyQ.IsLive("next-supply"))
			require.True(t, copyQ.IsLive("next-bob"))
			require.Equal(t, keyline.None, copyQ.EffectivePower("doc", "alice"))
		}

		require.NoError(t, replica.View(ctx, func(tx keyline.ReadTx) error {
			n, found, err := tx.Node(ctx, "doc")
			require.NoError(t, err)
			require.True(t, found)
			require.EqualValues(t, 1007, n.BlobID)
			_, found, err = tx.Node(ctx, "other-doc")
			require.NoError(t, err)
			require.False(t, found)
			_, found, err = tx.Delegation(ctx, "unrelated")
			require.NoError(t, err)
			require.False(t, found, "unrelated authority is not replicated")
			_, found, err = tx.Revocation(ctx, "alice-ban")
			require.NoError(t, err)
			require.True(t, found, "rotation must not erase historical revocations")
			return nil
		}))
	}
}

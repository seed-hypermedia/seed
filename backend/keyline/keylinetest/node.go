package keylinetest

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

func testNodeMentionArrivalOrder(t *testing.T, newStore NewStore) {
	// All permutations include a timestamp tie, embedded NUL and non-UTF-8
	// bytes, and a minimum whose local blob ID is numerically the largest.
	mentions := []keyline.NodeRecord{
		{ID: "doc", BlobID: 1, Timestamp: math.MaxInt64, BlobKey: "latest"},
		{ID: "doc", BlobID: 2, Timestamp: 0, BlobKey: "zero"},
		{ID: "doc", BlobID: 3, Timestamp: -10, BlobKey: "prefix\x00\xff"},
		{ID: "doc", BlobID: math.MaxInt64, Timestamp: -10, BlobKey: "prefix\x00\xfe"},
	}
	want := mentions[3]
	for _, mode := range []string{"single", "batch", "replace"} {
		t.Run(mode, func(t *testing.T) {
			order := slices.Clone(mentions)
			permutation := 0
			var visit func(int)

			visit = func(start int) {
				if start < len(order) {
					for i := start; i < len(order); i++ {
						order[start], order[i] = order[i], order[start]
						visit(start + 1)
						order[start], order[i] = order[i], order[start]
					}

					return
				}

				t.Run(fmt.Sprint(permutation), func(t *testing.T) {
					store := newStore(t)
					ctx := t.Context()
					base := keyline.Batch{
						Delegations: []keyline.Delegation{
							{ID: "grant", Issuer: "doc", Audience: "alice", Subject: "doc", Power: keyline.Read, BlobID: 10},
							{ID: "revoked", Issuer: "doc", Audience: "bob", Subject: "doc", Power: keyline.Write, BlobID: 11},
							{ID: "ungrounded", Issuer: "outsider", Audience: "carol", Subject: "doc", Power: keyline.Admin, BlobID: 12},
						},
						Revocations: []keyline.Revocation{{ID: "ban", Issuer: "bob", Target: "revoked", BlobID: 13}},
					}
					_, err := store.Apply(ctx, base)
					require.NoError(t, err)
					require.Equal(t, base, readTest(t, store, func(tx keyline.ReadTx) (keyline.Batch, error) {
						return keyline.Collect(tx.Records(ctx))
					}), "references alone never enumerate node mentions")
					assertBatchState(t, store, base, keyline.Batch{Nodes: []keyline.NodeRecord{{ID: "doc"}, {ID: "alice"}}})
					digest := readDigest(t, store)
					q := testQueries{t, store}
					members := q.Members("doc")
					require.Equal(t, map[keyline.Node]keyline.Power{"alice": keyline.Read}, members)
					powers := map[keyline.Node]keyline.Power{"doc": keyline.Admin, "alice": keyline.Read, "bob": keyline.None, "carol": keyline.None}
					for node, power := range powers {
						require.Equal(t, power, q.EffectivePower("doc", node))
					}

					live := map[keyline.ID]bool{"grant": true, "revoked": false, "ungrounded": false}
					for id, expected := range live {
						require.Equal(t, expected, q.IsLive(id))
					}

					if mode == "replace" {
						_, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{
							{ID: "doc", BlobID: 4, Timestamp: math.MaxInt64, BlobKey: "\xff\xff"},
						}})
						require.NoError(t, err)
					}

					if mode == "single" {
						for _, mention := range order {
							_, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{mention}})
							require.NoError(t, err)
						}
					} else {
						changed, err := store.Apply(ctx, keyline.Batch{Nodes: order})
						require.NoError(t, err)
						require.True(t, changed)
					}

					base.Nodes = []keyline.NodeRecord{want}
					assertBatchState(t, store, base, keyline.Batch{})
					closure := readClosure(t, store, "doc")
					require.Equal(t, base.Nodes, closure.Nodes)
					require.ElementsMatch(t, base.Delegations, closure.Delegations)
					require.Equal(t, base.Revocations, closure.Revocations)
					require.Equal(t, base, readTest(t, store, func(tx keyline.ReadTx) (keyline.Batch, error) {
						return keyline.Collect(tx.Records(ctx))
					}))
					require.Equal(t, digest, readDigest(t, store), "mention selection leaves the authority digest unchanged")
					require.Equal(t, members, q.Members("doc"), "mention selection leaves members unchanged")
					for node, power := range powers {
						require.Equal(t, power, q.EffectivePower("doc", node), "mention selection leaves powers unchanged")
					}

					for id, expected := range live {
						require.Equal(t, expected, q.IsLive(id), "mention selection leaves liveness unchanged")
					}

					changed, err := store.Apply(ctx, keyline.Batch{Nodes: order})
					require.NoError(t, err)
					require.False(t, changed, "replays and newer mentions report no change")
					assertBatchState(t, store, base, keyline.Batch{})
				})
				permutation++
			}
			visit(0)
			require.Equal(t, 24, permutation)
		})
	}
}

func testNodeMentionUpdatesAndRollback(t *testing.T, newStore NewStore) {
	store := newStore(t)
	ctx := t.Context()
	selected := keyline.NodeRecord{ID: "doc", BlobID: 1, Timestamp: 10, BlobKey: "original"}
	base := keyline.Batch{Nodes: []keyline.NodeRecord{selected}}
	changed, err := store.Apply(ctx, base)
	require.NoError(t, err)
	require.True(t, changed)
	for _, conflict := range []keyline.NodeRecord{
		{ID: "doc", BlobID: 2, Timestamp: 10, BlobKey: "original"},
		{ID: "doc", BlobID: 1, Timestamp: 9, BlobKey: "original"},
		{ID: "doc", BlobID: 1, Timestamp: 11, BlobKey: "original"},
	} {
		changed, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{conflict}})
		require.ErrorIs(t, err, keyline.ErrConflict)
		require.False(t, changed)
		assertBatchState(t, store, base, keyline.Batch{})
	}

	earlier := keyline.NodeRecord{ID: "doc", BlobID: 3, Timestamp: 0, BlobKey: "earlier"}
	for _, conflict := range []keyline.NodeRecord{
		{ID: "doc", BlobID: 4, Timestamp: 0, BlobKey: "earlier"},
		{ID: "doc", BlobID: 3, Timestamp: -1, BlobKey: "earlier"},
		{ID: "doc", BlobID: 3, Timestamp: 1, BlobKey: "earlier"},
	} {
		changed, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{earlier, conflict}})
		require.ErrorIs(t, err, keyline.ErrConflict, "check the staged selection before the committed mention")
		require.False(t, changed)
		assertBatchState(t, store, base, keyline.Batch{})
	}

	changed, err = store.Apply(ctx, keyline.Batch{
		Nodes:       []keyline.NodeRecord{earlier},
		Delegations: []keyline.Delegation{{ID: "invalid"}},
	})
	require.Error(t, err)
	require.False(t, changed)
	assertBatchState(t, store, base, keyline.Batch{})

	// A later candidate in the same batch must not overwrite the staged
	// minimum by comparing only against the committed record.
	changed, err = store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{
		earlier, {ID: "doc", BlobID: 5, Timestamp: 5, BlobKey: "middle"}, selected,
	}})
	require.NoError(t, err)
	require.True(t, changed)
	base.Nodes[0] = earlier
	assertBatchState(t, store, base, keyline.Batch{})
	for _, batch := range []keyline.Batch{{}, base, {Nodes: []keyline.NodeRecord{selected}}} {
		changed, err := store.Apply(ctx, batch)
		require.NoError(t, err)
		require.False(t, changed)
	}

	oldest := keyline.NodeRecord{ID: "doc", BlobID: 6, Timestamp: math.MinInt64, BlobKey: "oldest"}
	changed, err = store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{oldest}})
	require.NoError(t, err)
	require.True(t, changed)
	base.Nodes[0] = oldest
	assertBatchState(t, store, base, keyline.Batch{})
}

func testNodeMentionTieAcrossReplicas(t *testing.T, newStore NewStore) {
	for _, reversed := range []bool{false, true} {
		t.Run(fmt.Sprint(reversed), func(t *testing.T) {
			store := newStore(t)
			// Opposite arrival order and opposite numeric ID order must still
			// select the same stable key, without normalizing its opaque bytes.
			mentions := []keyline.NodeRecord{
				{ID: "doc", BlobID: 1, Timestamp: -1, BlobKey: "b"},
				{ID: "doc", BlobID: 2, Timestamp: -1, BlobKey: " a "},
			}
			wantID := int64(2)

			if reversed {
				mentions[0].BlobID, mentions[1].BlobID = 200, 100
				wantID = 100
				slices.Reverse(mentions)
			}

			for _, mention := range mentions {
				_, err := store.Apply(t.Context(), keyline.Batch{Nodes: []keyline.NodeRecord{mention}})
				require.NoError(t, err)
			}

			require.Equal(t, []keyline.NodeRecord{{ID: "doc", BlobID: wantID, Timestamp: -1, BlobKey: " a "}}, readClosure(t, store, "doc").Nodes)
		})
	}
}

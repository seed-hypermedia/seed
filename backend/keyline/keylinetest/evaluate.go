//nolint:govet // Conformance facts are dense positional tables, as in _test.go files.
package keylinetest

import (
	"fmt"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// testWideEvaluation evaluates a subject with more members than any real
// document has, with no resource limits.
func testWideEvaluation(t *testing.T, newStore NewStore) {
	store := newStore(t)
	_, err := store.Apply(t.Context(), authorityShape("direct", 10001))
	require.NoError(t, err)
	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		members, err := keyline.Members(t.Context(), tx, "doc")
		require.NoError(t, err)
		require.Len(t, members, 10001)
		require.Equal(t, keyline.Write, members["n10000"])
		return nil
	}))
}

// authorityShape includes the role gift ladder from upstream's conformance
// suite at a depth that exposed the prototype's repeated fixed-point searches.
func authorityShape(shape string, size int) keyline.Batch {
	var batch keyline.Batch

	for i := range size {
		n := keyline.Node(fmt.Sprintf("n%d", i))

		previous := keyline.Node("doc")
		if i > 0 {
			previous = keyline.Node(fmt.Sprintf("n%d", i-1))
		}

		switch shape {
		case "direct":
			batch.Delegations = append(batch.Delegations, keyline.Delegation{keyline.ID(n), "doc", n, "doc", keyline.Write, 1})
		case "chain":
			batch.Delegations = append(batch.Delegations, keyline.Delegation{keyline.ID(n), previous, n, "doc", keyline.Write, 1})
		case "roles":
			batch.Delegations = append(batch.Delegations, keyline.Delegation{keyline.ID(n), previous, n, previous, keyline.Write, 1})
			batch.Delegations = append(batch.Delegations, keyline.Delegation{keyline.ID("owner-" + n), n, "attacker", n, keyline.Admin, 1})
		default:
			panic("unknown authority shape")
		}
	}

	if shape == "roles" {
		batch.Delegations = append(batch.Delegations, keyline.Delegation{"gift", "attacker", "victim", keyline.Node(fmt.Sprintf("n%d", size-1)), keyline.Admin, 1})
	}

	return batch
}

func testDeepAuthority(t *testing.T, newStore NewStore) {
	for _, shape := range []string{"chain", "roles"} {
		t.Run(shape, func(t *testing.T) {
			size := 256
			if shape == "roles" {
				size = 64
			}

			batch := authorityShape(shape, size)
			facts := testFacts{Delegations: batch.Delegations}
			store := facts.store(t, newStore)
			q := testQueries{t, store}
			target := keyline.Node(fmt.Sprintf("n%d", size-1))
			require.Equal(t, keyline.Write, q.EffectivePower("doc", target))
			require.True(t, q.IsLive(keyline.ID(target)))

			if shape == "roles" {
				require.Equal(t, keyline.Write, q.EffectivePower("doc", "victim"))
			}

			_, err := store.Apply(t.Context(), keyline.Batch{Revocations: []keyline.Revocation{{"remove-root", "doc", "n0", 2}}})
			require.NoError(t, err)
			require.Equal(t, keyline.None, q.EffectivePower("doc", target))

			if shape == "roles" {
				require.Equal(t, keyline.None, q.EffectivePower("doc", "victim"))
				require.True(t, q.IsLive("gift"), "role-local authority survives loss of doc access")
			} else {
				require.False(t, q.IsLive(keyline.ID(target)), "an uncovered edge still needs grounded standing")
			}
		})
	}
}

// BenchmarkEvaluation measures EffectivePower over direct, chained, and
// role-composed graphs in stores from newStore.
func BenchmarkEvaluation(b *testing.B, newStore NewStore) {
	for _, shape := range []string{"direct", "chain", "roles"} {
		b.Run(shape, func(b *testing.B) {
			size := 256
			if shape == "roles" {
				size = 64
			}

			store := newStore(b)
			_, err := store.Apply(b.Context(), authorityShape(shape, size))
			require.NoError(b, err)
			target := keyline.Node(fmt.Sprintf("n%d", size-1))
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				err := store.View(b.Context(), func(tx keyline.ReadTx) error {
					power, err := keyline.EffectivePower(b.Context(), tx, "doc", target)
					if err != nil {
						return err
					}

					if power != keyline.Write {
						return fmt.Errorf("got power %s, want Write", power)
					}

					return nil
				})
				require.NoError(b, err)
			}
		})
	}
}

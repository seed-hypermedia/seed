package blob

import (
	"cmp"
	"maps"
	"math/rand/v2"
	"seed/backend/util/attrkey"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type attrWrite struct {
	key   string
	value any
	ts    int64
	op    int
	actor uint64
}

func compareAttrWrites(a, b attrWrite) int {
	return cmp.Or(cmp.Compare(a.ts, b.ts), cmp.Compare(a.op, b.op), cmp.Compare(a.actor, b.actor))
}

func isAttrRelated(a, b string) bool { return isAttrAncestor(a, b) || isAttrAncestor(b, a) }

// isAttrAncestor reports whether dotted path a is a strict ancestor of b.
func isAttrAncestor(a, b string) bool {
	return len(a) < len(b) && b[len(a)] == '.' && b[:len(a)] == a
}

// sortedAttrOracle applies writes sorted by (ts, operation, actor), which is
// what indexing changes in time order does and what defines the correct
// result. Each write then simply replaces every related path.
func sortedAttrOracle(writes []attrWrite) map[string]any {
	sorted := slices.Clone(writes)
	slices.SortFunc(sorted, compareAttrWrites)

	state := map[string]attrWrite{}
	for _, w := range sorted {
		for k := range state {
			if isAttrRelated(k, w.key) {
				delete(state, k)
			}
		}

		state[w.key] = w
	}

	var live []attrWrite

	for _, w := range state {
		if w.value != nil {
			live = append(live, w)
		}
	}

	slices.SortFunc(live, compareAttrWrites)
	out := map[string]any{}
	for _, w := range live {
		attrkey.Set(out, strings.Split(w.key, "."), w.value)
	}

	return out
}

func applyAttrWrites(writes []attrWrite) map[string]any {
	m := DocIndexedAttrs{}
	ix := newAttrIndex(m)
	for _, w := range writes {
		ix.setOrdered(w.key, w.value, w.ts, w.op, w.actor)
	}

	return m.PublicMap()
}

func attrPermutations(in []attrWrite) [][]attrWrite {
	if len(in) <= 1 {
		return [][]attrWrite{slices.Clone(in)}
	}

	var out [][]attrWrite

	for i := range in {
		rest := slices.Concat(in[:i], in[i+1:])
		for _, p := range attrPermutations(rest) {
			out = append(out, append([]attrWrite{in[i]}, p...))
		}
	}

	return out
}

func TestDocIndexedAttrsMatchSortedOracle(t *testing.T) {
	t.Parallel()

	w := func(key string, value any, ts int64) attrWrite {
		return attrWrite{key: key, value: value, ts: ts, actor: 1}
	}

	tests := []struct {
		name   string
		writes []attrWrite
		want   map[string]any
	}{
		{
			name:   "late parent between children",
			writes: []attrWrite{w("theme.Color", "Red", 1), w("theme", "Dark", 2), w("theme.Font", "Serif", 3)},
			want:   map[string]any{"theme": map[string]any{"Font": "Serif"}},
		},
		{
			name:   "stale parent clears no newer child",
			writes: []attrWrite{w("theme", "Dark", 1), w("theme.Color", "Red", 2), w("theme.Font", "Serif", 3), w("theme.Size", "Big", 4)},
			want:   map[string]any{"theme": map[string]any{"Color": "Red", "Font": "Serif", "Size": "Big"}},
		},
		{
			name:   "newer parent clears all older children",
			writes: []attrWrite{w("theme.Color", "Red", 1), w("theme.Font", "Serif", 2), w("theme.Size", "Big", 3), w("theme", "Dark", 4)},
			want:   map[string]any{"theme": "Dark"},
		},
		{
			name:   "replaced parent keeps its own order",
			writes: []attrWrite{w("theme.Font", "Serif", 10), w("theme", "Dark", 20), w("theme.Size", "Big", 25), w("theme.Color", "Red", 30)},
			want:   map[string]any{"theme": map[string]any{"Size": "Big", "Color": "Red"}},
		},
		{
			name:   "multiple levels and a lookalike sibling",
			writes: []attrWrite{w("a.b.c", "c1", 1), w("ab", "ab", 2), w("a.d", "d", 3), w("a.b", "b", 4), w("a.b.c", "c2", 5)},
			want:   map[string]any{"a": map[string]any{"b": map[string]any{"c": "c2"}, "d": "d"}, "ab": "ab"},
		},
		{
			name:   "tombstone does not resurrect what it replaced",
			writes: []attrWrite{w("theme", "Dark", 1), w("theme.Color", "Red", 2), w("theme.Size", "Big", 3), w("theme.Color", nil, 4)},
			want:   map[string]any{"theme": map[string]any{"Size": "Big"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, sortedAttrOracle(tt.writes), "the oracle itself")
			for _, order := range attrPermutations(tt.writes) {
				for range 5 { // Map iteration order varies between runs; repeat to catch nondeterminism.
					require.Equal(t, tt.want, applyAttrWrites(order), "order %v", order)
				}
			}
		})
	}
}

func TestDocIndexedAttrsRandomOrdersMatchSortedOracle(t *testing.T) {
	t.Parallel()

	keys := []string{"a", "a.b", "a.b.c", "a.b.d", "a.e", "ab", "b", "b.c"}
	values := []any{"x", "y", nil}

	rng := rand.New(rand.NewPCG(3, 4))
	for range 3000 {
		n := 1 + rng.IntN(8)
		writes := make([]attrWrite, n)
		type order struct {
			ts    int64
			op    int
			actor uint64
		}

		used := map[order]bool{}
		for i := range writes {
			var o order

			for {
				o = order{ts: int64(rng.IntN(6)), op: rng.IntN(2), actor: 1 + rng.Uint64N(3)}
				if !used[o] {
					break
				}
			}

			used[o] = true
			writes[i] = attrWrite{key: keys[rng.IntN(len(keys))], value: values[rng.IntN(len(values))], ts: o.ts, op: o.op, actor: o.actor}
		}

		want := sortedAttrOracle(writes)
		for range 10 {
			shuffled := slices.Clone(writes)
			rng.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
			require.Equal(t, want, applyAttrWrites(shuffled), "writes %v order %v", writes, shuffled)
		}
	}
}

// setOrderedByScan is the original setOrdered, which compared the write against
// every key in the map. It stays here as the reference the indexed version must
// match exactly, tombstones included.
func setOrderedByScan(m DocIndexedAttrs, k string, v any, ts int64, operation int, actor uint64) {
	kind, _, err := documentAttributeValue(v)
	if err != nil {
		panic(err)
	}

	vNew := IndexedValue{Key: k, Value: v, Ts: ts, Operation: operation, Actor: actor, Kind: kind}

	var olderDescendants, olderAncestors []string

	newerDescendant := false
	for otherKey, other := range m {
		order := compareIndexedOrder(other, vNew)
		switch {
		case otherKey == k:
			if order > 0 || order == 0 && !indexedValueWinsTie(vNew, other) {
				return
			}
		case isAttrAncestor(otherKey, k):
			if order >= 0 {
				return
			}

			olderAncestors = append(olderAncestors, otherKey)
		case isAttrAncestor(k, otherKey):
			if order > 0 {
				newerDescendant = true
			} else {
				olderDescendants = append(olderDescendants, otherKey)
			}
		}
	}

	if newerDescendant {
		vNew.Value = nil
		vNew.Kind = documentAttributeNull
	}

	m[k] = vNew
	for _, otherKey := range olderDescendants {
		delete(m, otherKey)
	}

	for _, otherKey := range olderAncestors {
		ancestor := m[otherKey]
		if ancestor.Value != nil {
			ancestor.Value = nil
			ancestor.Kind = documentAttributeNull
			m[otherKey] = ancestor
		}
	}
}

func TestAttrIndexMatchesFullScan(t *testing.T) {
	t.Parallel()

	// Neighbours in sort order that are not descendants ("a-b", "ab", "a/b"),
	// empty segments, and a leading dot exercise the descendant range bounds.
	keys := []string{"a", "a.b", "a.b.c", "a.c", "a-b", "a/b", "ab", "a..b", "a.", ".a", "b", "b.a"}
	values := []any{"x", "y", nil, int64(1)}

	rng := rand.New(rand.NewPCG(5, 6))
	for range 2000 {
		got := DocIndexedAttrs{}
		ix := newAttrIndex(got)
		want := DocIndexedAttrs{}

		for range 1 + rng.IntN(12) {
			k := keys[rng.IntN(len(keys))]
			v := values[rng.IntN(len(values))]
			ts, op, actor := int64(rng.IntN(4)), rng.IntN(2), 1+rng.Uint64N(2)

			ix.setOrdered(k, v, ts, op, actor)
			setOrderedByScan(want, k, v, ts, op, actor)

			require.Equal(t, want, got)
			require.Equal(t, slices.Sorted(maps.Keys(got)), ix.keys, "the sorted keys must track the map")
		}
	}
}

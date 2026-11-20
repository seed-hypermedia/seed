package docmodel

import (
	"math/rand/v2"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/attrkey"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// permutations returns every ordering of in.
func permutations[T any](in []T) [][]T {
	if len(in) <= 1 {
		return [][]T{append([]T(nil), in...)}
	}

	var out [][]T

	for i := range in {
		rest := make([]T, 0, len(in)-1)
		rest = append(rest, in[:i]...)
		rest = append(rest, in[i+1:]...)
		for _, p := range permutations(rest) {
			out = append(out, append([]T{in[i]}, p...))
		}
	}

	return out
}

func TestLWWRegHighestOpIDWinsInAnyOrder(t *testing.T) {
	t.Parallel()

	type write struct {
		id opID
		v  string
	}

	writes := []write{
		{opID{Ts: 10, Idx: 0, Actor: 1}, "a"},
		{opID{Ts: 30, Idx: 0, Actor: 1}, "b"},
		{opID{Ts: 20, Idx: 5, Actor: 2}, "c"},
		{opID{Ts: 30, Idx: 0, Actor: 2}, "d"}, // Same ts and idx as "b": the higher actor wins.
	}

	for _, order := range permutations(writes) {
		reg := newLWWReg[string]()
		for _, w := range order {
			reg.Set(w.id, w.v)
		}

		id, v, ok := reg.GetLatestWithID()
		require.True(t, ok)
		require.Equal(t, "d", v, "order %v", order)
		require.Equal(t, opID{Ts: 30, Idx: 0, Actor: 2}, id)
	}
}

func TestLWWRegEmpty(t *testing.T) {
	t.Parallel()

	reg := newLWWReg[string]()
	_, ok := reg.GetLatestOK()
	require.False(t, ok)
	require.Equal(t, "", reg.GetLatest())
}

// Concurrent replacements of the same block must resolve to the same content
// no matter the order the changes are applied in. Before the register kept the
// highest op ID, it kept whichever change was applied last, so a late-arriving
// older concurrent change overwrote a newer one.
func TestBlockContentIndependentOfApplyOrder(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	genesisDoc := must.Do2(New("mydoc", cclock.New()))
	must.Do(genesisDoc.MoveBlock("b1", "", ""))
	must.Do(genesisDoc.ReplaceBlock(&documents.Block{Id: "b1", Type: "Paragraph", Text: "genesis"}))
	genesis := must.Do2(genesisDoc.SignChangeAt(alice, base))

	load := func(changes ...blob.Encoded[*blob.Change]) *Document {
		doc := must.Do2(New("mydoc", cclock.New()))
		for _, ch := range changes {
			must.Do(doc.ApplyChange(ch.CID, ch.Decoded))
		}

		return doc
	}

	// Each replacement is concurrent with the others: all depend only on genesis.
	replace := func(signer *core.KeyPair, at time.Time, text string) blob.Encoded[*blob.Change] {
		doc := load(genesis)
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "b1", Type: "Paragraph", Text: text}))
		return must.Do2(doc.SignChangeAt(signer, at))
	}

	text := func(doc *Document) string {
		_, blk, ok := doc.crdt.stateBlocks["b1"].GetLatestWithID()
		require.True(t, ok)
		return blk.Text
	}

	t.Run("newest timestamp wins", func(t *testing.T) {
		t.Parallel()

		concurrent := []blob.Encoded[*blob.Change]{
			replace(alice, base.Add(1*time.Second), "alice"),
			replace(bob, base.Add(3*time.Second), "bob"),
			replace(carol, base.Add(2*time.Second), "carol"),
		}

		for _, order := range permutations(concurrent) {
			doc := load(append([]blob.Encoded[*blob.Change]{genesis}, order...)...)
			require.Equal(t, "bob", text(doc))
		}
	})

	t.Run("equal timestamps resolve by actor", func(t *testing.T) {
		t.Parallel()

		at := base.Add(5 * time.Second)
		byBob := replace(bob, at, "bob")
		byCarol := replace(carol, at, "carol")

		want := "bob"
		if carol.Principal().ActorID() > bob.Principal().ActorID() {
			want = "carol"
		}

		for _, order := range permutations([]blob.Encoded[*blob.Change]{byBob, byCarol}) {
			doc := load(append([]blob.Encoded[*blob.Change]{genesis}, order...)...)
			require.Equal(t, want, text(doc))
		}
	})
}

// Concurrent metadata writes to a key and its parent/child paths must converge
// in any apply order, and a stale write landing after a newer one must change
// nothing: neither the key's own value nor the related paths it would clear.
func TestMetadataIndependentOfApplyOrder(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	genesisDoc := must.Do2(New("mydoc", cclock.New()))
	must.Do(genesisDoc.SetAttribute("", []string{"title"}, "Doc"))
	genesis := must.Do2(genesisDoc.SignChangeAt(alice, base))

	load := func(changes ...blob.Encoded[*blob.Change]) *Document {
		doc := must.Do2(New("mydoc", cclock.New()))
		for _, ch := range changes {
			must.Do(doc.ApplyChange(ch.CID, ch.Decoded))
		}

		return doc
	}

	set := func(signer *core.KeyPair, at time.Time, key []string, value any) blob.Encoded[*blob.Change] {
		doc := load(genesis)
		must.Do(doc.SetAttribute("", key, value))
		return must.Do2(doc.SignChangeAt(signer, at))
	}

	t.Run("newest structural write wins", func(t *testing.T) {
		t.Parallel()

		concurrent := []blob.Encoded[*blob.Change]{
			set(alice, base.Add(1*time.Second), []string{"theme"}, "Legacy"),
			set(bob, base.Add(3*time.Second), []string{"theme", "Color"}, "Red"),
			set(carol, base.Add(2*time.Second), []string{"theme"}, "Plain"),
		}

		want := map[string]any{"title": "Doc", "theme": map[string]any{"Color": "Red"}}
		for _, order := range permutations(concurrent) {
			doc := load(append([]blob.Encoded[*blob.Change]{genesis}, order...)...)
			require.Equal(t, want, doc.crdt.GetMetadata())
			require.Equal(t, 2, valueEntries(doc.crdt), "the replaced parent must be a tombstone")
		}
	})

	t.Run("stale write after a newer one changes nothing", func(t *testing.T) {
		t.Parallel()

		newerParent := set(bob, base.Add(5*time.Second), []string{"theme"}, "Dark")
		staleChild := set(carol, base.Add(4*time.Second), []string{"theme", "Color"}, "Red")
		staleParent := set(alice, base.Add(1*time.Second), []string{"theme"}, "Legacy")

		want := map[string]any{"title": "Doc", "theme": "Dark"}
		for _, order := range permutations([]blob.Encoded[*blob.Change]{newerParent, staleChild, staleParent}) {
			doc := load(append([]blob.Encoded[*blob.Change]{genesis}, order...)...)
			require.Equal(t, want, doc.crdt.GetMetadata())
		}
	})
}

type metaWrite struct {
	id    opID
	key   []string
	value any
}

// sortedOracle applies writes in op ID order, which is what a full replay in
// time order does and what defines the correct result. With every write newer
// than all before it, a write simply replaces its whole related subtree and
// chain: it clears every existing ancestor and descendant, then records itself.
func sortedOracle(writes []metaWrite) map[string]any {
	sorted := slices.Clone(writes)
	slices.SortFunc(sorted, func(a, b metaWrite) int { return a.id.Compare(b.id) })

	type rec struct {
		id    opID
		key   []string
		value any
	}

	state := map[string]rec{}
	for _, w := range sorted {
		for k, r := range state {
			if isMetadataAncestor(r.key, w.key) || isMetadataAncestor(w.key, r.key) {
				delete(state, k)
			}
		}

		state[strings.Join(w.key, ".")] = rec(w)
	}

	var recs []rec

	for _, r := range state {
		if r.value != nil {
			recs = append(recs, r)
		}
	}

	slices.SortFunc(recs, func(a, b rec) int { return a.id.Compare(b.id) })
	out := map[string]any{}
	for _, r := range recs {
		attrkey.Set(out, r.key, r.value)
	}

	return out
}

func applyMeta(writes []metaWrite) map[string]any {
	crdt := newCRDT("mydoc", cclock.New())
	for _, w := range writes {
		crdt.setMetadata(w.id, w.key, w.value)
	}

	return crdt.GetMetadata()
}

func k(path string) []string { return strings.Split(path, ".") }

func TestMetadataMatchesSortedOracle(t *testing.T) {
	t.Parallel()

	id := func(ts int64) opID { return opID{Ts: ts, Actor: 1} }

	tests := []struct {
		name   string
		writes []metaWrite
		want   map[string]any
	}{
		{
			// A late parent newer than one child and older than another. The
			// parent clears the older child, then the newer child replaces the parent.
			name: "late parent between children",
			writes: []metaWrite{
				{id(1), k("theme.Color"), "Red"},
				{id(2), k("theme"), "Dark"},
				{id(3), k("theme.Font"), "Serif"},
			},
			want: map[string]any{"theme": map[string]any{"Font": "Serif"}},
		},
		{
			name: "stale parent clears no newer child",
			writes: []metaWrite{
				{id(1), k("theme"), "Dark"},
				{id(2), k("theme.Color"), "Red"},
				{id(3), k("theme.Font"), "Serif"},
				{id(4), k("theme.Size"), "Big"},
			},
			want: map[string]any{"theme": map[string]any{"Color": "Red", "Font": "Serif", "Size": "Big"}},
		},
		{
			name: "newer parent clears all older children",
			writes: []metaWrite{
				{id(1), k("theme.Color"), "Red"},
				{id(2), k("theme.Font"), "Serif"},
				{id(3), k("theme.Size"), "Big"},
				{id(4), k("theme"), "Dark"},
			},
			want: map[string]any{"theme": "Dark"},
		},
		{
			name: "winning child clears older parent, siblings written later survive",
			writes: []metaWrite{
				{id(1), k("theme"), "Dark"},
				{id(2), k("theme.Color"), "Red"},
				{id(3), k("theme.Font"), "Serif"},
			},
			want: map[string]any{"theme": map[string]any{"Color": "Red", "Font": "Serif"}},
		},
		{
			name: "multiple levels and a lookalike sibling",
			writes: []metaWrite{
				{id(1), k("a.b.c"), "c1"},
				{id(2), k("ab"), "ab"},
				{id(3), k("a.d"), "d"},
				{id(4), k("a.b"), "b"},
				{id(5), k("a.b.c"), "c2"},
			},
			want: map[string]any{"a": map[string]any{"b": map[string]any{"c": "c2"}, "d": "d"}, "ab": "ab"},
		},
		{
			name: "root write over a deep tree",
			writes: []metaWrite{
				{id(1), k("a.b.c"), "c"},
				{id(2), k("a.d"), "d"},
				{id(3), k("a.b.e"), "e"},
				{id(4), k("ab"), "ab"},
				{id(5), k("a"), "root"},
				{id(6), k("a.b.f"), "f"},
			},
			want: map[string]any{"a": map[string]any{"b": map[string]any{"f": "f"}}, "ab": "ab"},
		},
		{
			// theme@2 is replaced by Color@3 but must keep superseding older
			// children at its own op ID: Font@1 is removed, Size@2.5 survives.
			name: "replaced parent keeps its own op ID",
			writes: []metaWrite{
				{id(10), k("theme.Font"), "Serif"},
				{id(20), k("theme"), "Dark"},
				{id(25), k("theme.Size"), "Big"},
				{id(30), k("theme.Color"), "Red"},
			},
			want: map[string]any{"theme": map[string]any{"Size": "Big", "Color": "Red"}},
		},
		{
			name: "tombstone does not resurrect what it replaced",
			writes: []metaWrite{
				{id(1), k("theme"), "Dark"},
				{id(2), k("theme.Color"), "Red"},
				{id(3), k("theme.Size"), "Big"},
				{id(4), k("theme.Color"), nil},
			},
			want: map[string]any{"theme": map[string]any{"Size": "Big"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, sortedOracle(tt.writes), "the oracle itself")
			for _, order := range permutations(tt.writes) {
				require.Equal(t, tt.want, applyMeta(order), "order %v", order)
			}
		})
	}
}

// Random write sets over a small key tree, applied in random orders, must
// always match the sorted oracle.
func TestMetadataRandomOrdersMatchSortedOracle(t *testing.T) {
	t.Parallel()

	keys := []string{"a", "a.b", "a.b.c", "a.b.d", "a.e", "ab", "b", "b.c"}
	values := []any{"x", "y", nil}

	rng := rand.New(rand.NewPCG(1, 2))
	for range 3000 {
		n := 1 + rng.IntN(8)
		writes := make([]metaWrite, n)
		used := map[opID]bool{}
		for i := range writes {
			var id opID

			for {
				id = opID{Ts: int64(rng.IntN(6)), Idx: int64(rng.IntN(2)), Actor: core.ActorID(1 + rng.Uint64N(3))}
				if !used[id] {
					break
				}
			}

			used[id] = true
			writes[i] = metaWrite{id: id, key: k(keys[rng.IntN(len(keys))]), value: values[rng.IntN(len(values))]}
		}

		want := sortedOracle(writes)
		for range 10 {
			order := slices.Clone(writes)
			rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
			require.Equal(t, want, applyMeta(order), "writes %v order %v", writes, order)
		}
	}
}

// valueEntries counts metadata entries holding a value, i.e. not tombstones.
func valueEntries(c *docCRDT) int {
	n := 0
	for _, reg := range c.stateMetadata.Items() {
		if reg.GetLatest().Value != nil {
			n++
		}
	}

	return n
}

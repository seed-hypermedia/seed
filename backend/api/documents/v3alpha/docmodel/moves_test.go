package docmodel

import (
	"fmt"
	"math/rand"
	"slices"
	"strings"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

// These tests cover the moves a change ends up storing. They always apply
// the produced change to a fresh document loaded from the encoded bytes,
// because that's what readers see: the in-memory state of the mutated document
// keeps the moves that are dropped when the change is written.

type moveCase struct {
	// Initial tree, in the outline format: "a b(b1 b2) c".
	initial string
	// Request applied on top of the initial tree.
	request func(doc *Document)
	// Tree that must be read back.
	want string
	// Blocks whose moves must be stored, in any order.
	wantMoved []string
	// Number of stored moves, when there's more than one smallest set of blocks to move.
	wantNMoved int
	// Blocks whose deletes must be stored, in any order.
	wantDeleted []string
}

func mv(doc *Document, block, parent, left string) {
	must.Do(doc.MoveBlock(block, parent, left))
}

func put(doc *Document, block string) {
	must.Do(doc.ReplaceBlock(&documents.Block{Id: block, Type: "Paragraph", Text: block}))
}

// relist moves every block of the level, in order, the way a client
// that diffs two trees re-lists a whole level.
func relist(doc *Document, parent string, blocks ...string) {
	var left string

	for _, b := range blocks {
		mv(doc, b, parent, left)
		left = b
	}
}

func TestMoves(t *testing.T) {
	cases := map[string]moveCase{
		"reported: redundant leading move, insert after unchanged first block": {
			initial: "f1 f2 f3",
			request: func(doc *Document) {
				mv(doc, "f1", "", "")
				mv(doc, "new", "", "f1")
				mv(doc, "f2", "", "new")
				mv(doc, "f3", "", "f2")
				put(doc, "new")
			},
			want:      "f1 new f2 f3",
			wantMoved: []string{"new"},
		},
		"insert after unchanged first block, only the leading move is redundant": {
			initial: "f1 f2 f3",
			request: func(doc *Document) {
				mv(doc, "f1", "", "")
				mv(doc, "new", "", "f1")
				put(doc, "new")
			},
			want:      "f1 new f2 f3",
			wantMoved: []string{"new"},
		},
		"insert in the middle of a fully re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "a", "b", "new", "c", "d")
				put(doc, "new")
			},
			want:      "a b new c d",
			wantMoved: []string{"new"},
		},
		"append to a fully re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "a", "b", "c", "d", "new")
				put(doc, "new")
			},
			want:      "a b c d new",
			wantMoved: []string{"new"},
		},
		"prepend to a fully re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "new", "a", "b", "c", "d")
				put(doc, "new")
			},
			want:      "new a b c d",
			wantMoved: []string{"new"},
		},
		"reorder with trailing unchanged blocks": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "b", "a", "c", "d")
			},
			want:      "b a c d",
			wantMoved: []string{"b"},
		},
		"reorder in the middle of a re-listed level, first block unchanged": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "a", "c", "b", "d")
			},
			want:      "a c b d",
			wantMoved: []string{"c"},
		},
		"reorder, then append to the re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "b", "a", "c", "d", "x")
				put(doc, "x")
			},
			want:      "b a c d x",
			wantMoved: []string{"b", "x"},
		},
		"nested levels re-listed, insert into each": {
			initial: "a(a1 a2) b(b1 b2(b21 b22)) c",
			request: func(doc *Document) {
				relist(doc, "", "a", "b", "c")
				relist(doc, "a", "a1", "n1", "a2")
				relist(doc, "b", "b1", "b2")
				relist(doc, "b2", "b21", "b22", "n2")
				put(doc, "n1")
				put(doc, "n2")
			},
			want:      "a(a1 n1 a2) b(b1 b2(b21 b22 n2)) c",
			wantMoved: []string{"n1", "n2"},
		},
		"nested first block re-listed, new child after it": {
			initial: "a(a1 a2) b",
			request: func(doc *Document) {
				mv(doc, "a1", "a", "")
				mv(doc, "n", "a", "a1")
				put(doc, "n")
			},
			want:      "a(a1 n a2) b",
			wantMoved: []string{"n"},
		},
		"delete and re-list": {
			initial: "a b c d",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("b"))
				relist(doc, "", "a", "c", "d")
			},
			want:        "a c d",
			wantDeleted: []string{"b"},
		},
		"delete the first block and re-list": {
			initial: "a b c d",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("a"))
				relist(doc, "", "b", "c", "d")
			},
			want:        "b c d",
			wantDeleted: []string{"a"},
		},
		"delete, re-list and insert": {
			initial: "a b c d",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("a"))
				relist(doc, "", "b", "new", "c", "d")
				put(doc, "new")
			},
			want:        "b new c d",
			wantMoved:   []string{"new"},
			wantDeleted: []string{"a"},
		},
		"re-list with nothing changed": {
			initial: "a(a1 a2) b(b1) c",
			request: func(doc *Document) {
				relist(doc, "", "a", "b", "c")
				relist(doc, "a", "a1", "a2")
				relist(doc, "b", "b1")
			},
			want: "a(a1 a2) b(b1) c",
		},
		"move to the start a block that is already first": {
			initial: "a b",
			request: func(doc *Document) {
				mv(doc, "a", "", "")
			},
			want: "a b",
		},
		"block inserted at the start, then the first block moved before it": {
			initial: "a b",
			request: func(doc *Document) {
				mv(doc, "new", "", "")
				mv(doc, "a", "", "")
				put(doc, "new")
			},
			want:      "a new b",
			wantMoved: []string{"new"},
		},
		"block moved away and back, then a block inserted after it": {
			initial: "a b c",
			request: func(doc *Document) {
				mv(doc, "b", "", "c")
				mv(doc, "b", "", "a")
				mv(doc, "new", "", "b")
				put(doc, "new")
			},
			want:      "a b new c",
			wantMoved: []string{"new"},
		},
		"reported: block moved to the end of a re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "a", "c", "d", "b")
			},
			want:      "a c d b",
			wantMoved: []string{"b"},
		},
		"first block moved to the end of a re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "b", "c", "d", "a")
			},
			want:      "b c d a",
			wantMoved: []string{"a"},
		},
		"third block moved to the end of a re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "a", "b", "d", "c")
			},
			want:       "a b d c",
			wantNMoved: 1,
		},
		"last block moved to the start of a re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "d", "a", "b", "c")
			},
			want:      "d a b c",
			wantMoved: []string{"d"},
		},
		"neighbouring blocks moved together in a re-listed level": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "c", "d", "a", "b")
			},
			want:       "c d a b",
			wantNMoved: 2,
		},
		"re-listed level reversed": {
			initial: "a b c d",
			request: func(doc *Document) {
				relist(doc, "", "d", "c", "b", "a")
			},
			want:       "d c b a",
			wantNMoved: 3,
		},
		"nested level re-listed with a block moved to the end": {
			initial: "p(a b c d) q",
			request: func(doc *Document) {
				relist(doc, "", "p", "q")
				relist(doc, "p", "a", "c", "d", "b")
			},
			want:      "p(a c d b) q",
			wantMoved: []string{"b"},
		},
		"block moved to the end with single moves": {
			initial: "a b c d",
			request: func(doc *Document) {
				mv(doc, "c", "", "a")
				mv(doc, "d", "", "c")
			},
			want:      "a c d b",
			wantMoved: []string{"b"},
		},
		"two adjacent blocks moved together keep their order": {
			initial: "a b c",
			request: func(doc *Document) {
				mv(doc, "a", "", "c")
				mv(doc, "b", "", "a")
			},
			want:      "c a b",
			wantMoved: []string{"c"},
		},
		"two adjacent blocks moved into another parent": {
			initial: "a b c",
			request: func(doc *Document) {
				mv(doc, "a", "c", "")
				mv(doc, "b", "c", "a")
			},
			want:      "c(a b)",
			wantMoved: []string{"a", "b"},
		},
		"block moved out of its parent and back": {
			initial: "a(a1 a2) b",
			request: func(doc *Document) {
				mv(doc, "a1", "", "b")
				mv(doc, "a1", "a", "")
				mv(doc, "n", "a", "a1")
				put(doc, "n")
			},
			want:      "a(a1 n a2) b",
			wantMoved: []string{"n"},
		},
		"deleted block restored in place": {
			initial: "a b c",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("b"))
				mv(doc, "b", "", "a")
			},
			want: "a b c",
		},
		"deleted block restored in place, then a block inserted after it": {
			initial: "a b c",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("b"))
				mv(doc, "b", "", "a")
				mv(doc, "new", "", "b")
				put(doc, "new")
			},
			want:      "a b new c",
			wantMoved: []string{"new"},
		},
		"deleted block restored somewhere else": {
			initial: "a b c",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("a"))
				mv(doc, "a", "", "c")
			},
			want:      "b c a",
			wantMoved: []string{"a"},
		},
		"block replaced after being deleted stays deleted": {
			initial: "a b c",
			request: func(doc *Document) {
				must.Do(doc.DeleteBlock("b"))
				must.Do(doc.ReplaceBlock(&documents.Block{Id: "b", Type: "Paragraph", Text: "changed"}))
			},
			want:        "a c",
			wantDeleted: []string{"b"},
		},
		"block created and deleted in the same change": {
			initial: "a b",
			request: func(doc *Document) {
				mv(doc, "new", "", "a")
				put(doc, "new")
				must.Do(doc.DeleteBlock("new"))
			},
			want: "a b",
		},
		"children created under a block that is then deleted": {
			initial: "a b",
			request: func(doc *Document) {
				mv(doc, "n", "a", "")
				put(doc, "n")
				must.Do(doc.DeleteBlock("a"))
			},
			want:        "b",
			wantMoved:   []string{"n"},
			wantDeleted: []string{"a"},
		},
		"parent moved while its children are re-listed with an insert": {
			initial: "a(a1 a2) b",
			request: func(doc *Document) {
				relist(doc, "", "b", "a")
				relist(doc, "a", "a1", "n", "a2")
				put(doc, "n")
			},
			want:      "b a(a1 n a2)",
			wantMoved: []string{"b", "n"},
		},
		"new parent with new children": {
			initial: "a b",
			request: func(doc *Document) {
				relist(doc, "", "a", "p", "b")
				relist(doc, "p", "p1", "p2")
				mv(doc, "p11", "p1", "")
				put(doc, "p")
				put(doc, "p1")
				put(doc, "p2")
				put(doc, "p11")
			},
			want:      "a p(p1(p11) p2) b",
			wantMoved: []string{"p", "p1", "p2", "p11"},
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			alice := coretest.NewTester("alice").Account

			c1 := buildOutline(t, tc.initial)
			require.Equal(t, tc.initial, outline(t, loadFromBytes(t, c1)), "initial tree must be read back")

			doc := loadFromBytes(t, c1)
			tc.request(doc)
			c2 := must.Do2(doc.SignChange(alice))

			moved, deleted := storedMoves(t, c2)
			require.Equal(t, tc.want, outline(t, loadFromBytes(t, c1, c2)), "tree read back after applying the change (stored moves=%v deletes=%v)", moved, deleted)

			if tc.wantNMoved > 0 {
				require.Len(t, moved, tc.wantNMoved, "stored moves")
			} else {
				require.ElementsMatch(t, tc.wantMoved, moved, "stored moves")
			}

			require.ElementsMatch(t, tc.wantDeleted, deleted, "stored deletes")

			// Listing the resulting tree again must not store anything.
			doc = loadFromBytes(t, c1, c2)
			relistOutline(doc, tc.want)
			c3 := must.Do2(doc.SignChange(alice))
			require.Empty(t, c3.Decoded.Body.Ops, "re-listing the resulting tree must produce no ops")
			require.Equal(t, 0, c3.Decoded.Body.OpCount)
		})
	}
}

// TestMoves_Random applies random valid requests and compares
// what is read back with a trivial model of the tree.
func TestMoves_Random(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	for seed := range fuzzInt(t, "DOCMODEL_FUZZ_SEEDS", 500) {
		rng := rand.New(rand.NewSource(int64(seed))) //nolint:gosec // Deterministic test input.

		model := newTreeModel()
		var changes []blob.Encoded[*blob.Change]

		for round := range 4 {
			doc := loadFromBytes(t, changes...)
			before := model.outline()

			var log []string

			nOps := 1 + rng.Intn(8)
			if round == 0 {
				nOps += 4
			}

			for range nOps {
				log = append(log, model.randomOp(rng, doc))
			}

			ch := must.Do2(doc.SignChange(alice))
			changes = append(changes, ch)

			moved, deleted := storedMoves(t, ch)
			got := outline(t, loadFromBytes(t, changes...))
			require.Equal(t, model.outline(), got, "seed=%d round=%d before=%q ops=%v moved=%v deleted=%v", seed, round, before, log, moved, deleted)

			if before == model.outline() && model.sameParents() {
				// Blocks created under a block that is deleted in the same change still get their moves,
				// so they don't show up as detached. Those are not visible.
				live := model.live()
				for _, b := range moved {
					require.NotContains(t, live, b, "seed=%d round=%d: nothing changed, ops=%v", seed, round, log)
				}

				require.Empty(t, deleted, "seed=%d round=%d: nothing changed, ops=%v", seed, round, log)
			}

			require.Len(t, uniq(moved), len(moved), "seed=%d round=%d: block moved more than once: %v", seed, round, moved)

			// Moves under deleted blocks are not visible, only those of the visible blocks have to be minimal.
			live := model.live()
			visibleMoves := slices.DeleteFunc(slices.Clone(moved), func(b string) bool { return !slices.Contains(live, b) })
			require.Len(t, visibleMoves, minimalMoves(model.prevChildren, model.children), "seed=%d round=%d before=%q after=%q ops=%v moved=%v", seed, round, before, got, log, moved)

			model.snapshot()

			// Listing the resulting tree again must not store anything.
			doc = loadFromBytes(t, changes...)
			relistOutline(doc, got)
			again := must.Do2(doc.SignChange(alice))
			require.Empty(t, again.Decoded.Body.Ops, "seed=%d round=%d: re-listing %q must produce no ops", seed, round, got)
		}
	}
}

// TestMoves_RandomRelist turns random nested trees into other random trees the way a client
// that diffs two trees does: deletes, then every level listed in full, block after block.
func TestMoves_RandomRelist(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	for seed := range fuzzInt(t, "DOCMODEL_FUZZ_SEEDS", 500) {
		rng := rand.New(rand.NewSource(int64(seed))) //nolint:gosec // Deterministic test input.

		var n int

		newBlock := func() string {
			n++
			return fmt.Sprintf("b%d", n)
		}

		// Random tree out of the given blocks.
		arrange := func(blocks []string) map[string][]string {
			children := map[string][]string{}
			placed := []string{""}

			for _, b := range blocks {
				parent := ""
				if rng.Intn(3) == 0 {
					parent = placed[rng.Intn(len(placed))]
				}

				children[parent] = slices.Insert(children[parent], rng.Intn(len(children[parent])+1), b)
				placed = append(placed, b)
			}

			return children
		}

		var blocks []string

		for range 2 + rng.Intn(8) {
			blocks = append(blocks, newBlock())
		}

		current := arrange(blocks)
		changes := []blob.Encoded[*blob.Change]{buildOutline(t, modelOutline(current))}

		for round := range 4 {
			before := modelOutline(current)
			require.Equal(t, before, outline(t, loadFromBytes(t, changes...)))

			var (
				target  map[string][]string
				removed []string
				existed = modelBlocks(current)
			)

			switch rng.Intn(3) {
			case 0:
				// Everything rearranged, some blocks removed, some added.
				var kept []string

				for _, b := range existed {
					if rng.Intn(5) == 0 {
						removed = append(removed, b)
					} else {
						kept = append(kept, b)
					}
				}

				for range rng.Intn(3) {
					kept = append(kept, newBlock())
				}

				rng.Shuffle(len(kept), func(i, j int) { kept[i], kept[j] = kept[j], kept[i] })
				target = arrange(kept)
			default:
				// A few small edits: a block moved within its level, a block added, a leaf removed.
				target = map[string][]string{}
				for k, v := range current {
					target[k] = slices.Clone(v)
				}

				for range 1 + rng.Intn(3) {
					parents := append([]string{""}, modelBlocks(target)...)
					parent := parents[rng.Intn(len(parents))]
					kids := target[parent]

					switch op := rng.Intn(4); {
					case op <= 1 && len(kids) > 1:
						i := rng.Intn(len(kids))
						b := kids[i]
						kids = slices.Delete(kids, i, i+1)
						target[parent] = slices.Insert(kids, rng.Intn(len(kids)+1), b)
					case op == 2:
						target[parent] = slices.Insert(kids, rng.Intn(len(kids)+1), newBlock())
					case len(kids) > 0:
						i := rng.Intn(len(kids))
						if b := kids[i]; len(target[b]) == 0 && slices.Contains(existed, b) {
							removed = append(removed, b)
							target[parent] = slices.Delete(kids, i, i+1)
						}
					}
				}
			}

			doc := loadFromBytes(t, changes...)

			for _, b := range removed {
				must.Do(doc.DeleteBlock(b))
			}

			// Levels are listed top down, so every parent is in place before its children.
			queue := []string{""}
			for len(queue) > 0 {
				parent := queue[0]
				queue = queue[1:]
				relist(doc, parent, target[parent]...)
				queue = append(queue, target[parent]...)
			}

			for _, b := range modelBlocks(target) {
				if !slices.Contains(existed, b) {
					put(doc, b)
				}
			}

			ch := must.Do2(doc.SignChange(alice))
			changes = append(changes, ch)

			moved, deleted := storedMoves(t, ch)
			info := fmt.Sprintf("seed=%d round=%d before=%q moved=%v deleted=%v", seed, round, before, moved, deleted)

			require.Equal(t, modelOutline(target), outline(t, loadFromBytes(t, changes...)), info)
			require.ElementsMatch(t, removed, deleted, info)
			require.Len(t, uniq(moved), len(moved), info)
			require.Len(t, moved, minimalMoves(current, target), "after=%q %s", modelOutline(target), info)

			current = target
		}
	}
}

func modelOutline(children map[string][]string) string {
	var walk func(parent string) string

	walk = func(parent string) string {
		parts := make([]string, 0, len(children[parent]))

		for _, c := range children[parent] {
			s := c
			if sub := walk(c); sub != "" {
				s += "(" + sub + ")"
			}

			parts = append(parts, s)
		}

		return strings.Join(parts, " ")
	}

	return walk("")
}

// modelBlocks returns the visible blocks of the tree in document order.
func modelBlocks(children map[string][]string) (out []string) {
	var walk func(parent string)

	walk = func(parent string) {
		for _, c := range children[parent] {
			out = append(out, c)
			walk(c)
		}
	}

	walk("")

	return out
}

func uniq(in []string) []string {
	out := slices.Clone(in)
	slices.Sort(out)
	return slices.Compact(out)
}

// treeModel is the simplest possible implementation of the block tree.
type treeModel struct {
	children map[string][]string
	parent   map[string]string
	prev     map[string]string
	// Children of every block at the time of the last snapshot.
	prevChildren map[string][]string
	n            int
}

func newTreeModel() *treeModel {
	return &treeModel{
		children: map[string][]string{},
		parent:   map[string]string{},
		prev:     map[string]string{},
	}
}

func (m *treeModel) snapshot() {
	m.prev = map[string]string{}
	for k, v := range m.parent {
		m.prev[k] = v
	}

	m.prevChildren = map[string][]string{}
	for k, v := range m.children {
		m.prevChildren[k] = slices.Clone(v)
	}
}

// minimalMoves returns the smallest number of moves turning the initial visible tree into the final one:
// on every level the longest run of blocks that keep their relative order can stay, the rest have to move.
func minimalMoves(initial, final map[string][]string) (n int) {
	var walk func(parent string)

	walk = func(parent string) {
		// Longest increasing subsequence of the initial indexes, the simple way.
		var best []int

		longest := 0

		for _, c := range final[parent] {
			walk(c)

			idx := slices.Index(initial[parent], c)
			if idx < 0 {
				best = append(best, 0)
				continue
			}

			run := 1

			for j, prevChild := range final[parent][:len(best)] {
				if pi := slices.Index(initial[parent], prevChild); pi >= 0 && pi < idx {
					run = max(run, best[j]+1)
				}
			}

			best = append(best, run)
			longest = max(longest, run)
		}

		n += len(final[parent]) - longest
	}

	walk("")

	return n
}

func (m *treeModel) sameParents() bool {
	for k, v := range m.parent {
		if pv, ok := m.prev[k]; ok && pv != v {
			return false
		}
	}

	return true
}

func (m *treeModel) outline() string {
	var walk func(parent string) string

	walk = func(parent string) string {
		var parts []string

		for _, c := range m.children[parent] {
			s := c
			if sub := walk(c); sub != "" {
				s += "(" + sub + ")"
			}

			parts = append(parts, s)
		}

		return strings.Join(parts, " ")
	}
	return walk("")
}

func (m *treeModel) live() []string {
	var out []string
	var walk func(parent string)

	walk = func(parent string) {
		for _, c := range m.children[parent] {
			out = append(out, c)
			walk(c)
		}
	}
	walk("")
	return out
}

func (m *treeModel) isAncestorOrSelf(a, b string) bool {
	for b != "" && b != TrashNodeID {
		if a == b {
			return true
		}

		b = m.parent[b]
	}

	return false
}

func (m *treeModel) detach(block string) {
	p, ok := m.parent[block]
	if !ok {
		return
	}

	m.children[p] = slices.DeleteFunc(m.children[p], func(s string) bool { return s == block })
}

func (m *treeModel) randomOp(rng *rand.Rand, doc *Document) string {
	live := m.live()
	known := make([]string, 0, len(m.parent))
	for b := range m.parent {
		known = append(known, b)
	}

	slices.Sort(known)

	// Deletes.
	if len(live) > 0 && rng.Intn(6) == 0 {
		b := live[rng.Intn(len(live))]
		must.Do(doc.DeleteBlock(b))
		m.detach(b)
		m.parent[b] = TrashNodeID
		m.children[TrashNodeID] = append(m.children[TrashNodeID], b)
		return "delete " + b
	}

	// Moves, of existing blocks most of the time.
	var block string

	if len(known) > 0 && rng.Intn(4) != 0 {
		block = known[rng.Intn(len(known))]
	} else {
		m.n++
		block = fmt.Sprintf("n%d", m.n)
		put(doc, block)
	}

	parents := []string{"", ""}
	for _, p := range live {
		if !m.isAncestorOrSelf(block, p) {
			parents = append(parents, p)
		}
	}

	parent := parents[rng.Intn(len(parents))]

	lefts := []string{""}
	for _, c := range m.children[parent] {
		if c != block {
			lefts = append(lefts, c)
		}
	}

	left := lefts[rng.Intn(len(lefts))]

	mv(doc, block, parent, left)

	m.detach(block)
	m.parent[block] = parent
	idx := slices.Index(m.children[parent], left) + 1
	m.children[parent] = slices.Insert(m.children[parent], idx, block)

	return fmt.Sprintf("move %s parent=%q left=%q", block, parent, left)
}

// parseOutline parses "a b(b1 b2) c" into (parent, block, left) triples in document order.
func parseOutline(s string) (out [][3]string) {
	var (
		parents = []string{""}
		lefts   = []string{""}
		cur     strings.Builder
	)

	flush := func() {
		if cur.Len() == 0 {
			return
		}

		id := cur.String()
		cur.Reset()
		out = append(out, [3]string{parents[len(parents)-1], id, lefts[len(lefts)-1]})
		lefts[len(lefts)-1] = id
	}

	for _, r := range s {
		switch r {
		case ' ':
			flush()
		case '(':
			flush()
			parents = append(parents, lefts[len(lefts)-1])
			lefts = append(lefts, "")
		case ')':
			flush()
			parents = parents[:len(parents)-1]
			lefts = lefts[:len(lefts)-1]
		default:
			cur.WriteRune(r)
		}
	}

	flush()

	return out
}

func relistOutline(doc *Document, s string) {
	for _, m := range parseOutline(s) {
		mv(doc, m[1], m[0], m[2])
	}
}

func buildOutline(t *testing.T, s string) blob.Encoded[*blob.Change] {
	t.Helper()

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.SetMetadata("title", "Hello"))
	for _, m := range parseOutline(s) {
		mv(doc, m[1], m[0], m[2])
		put(doc, m[1])
	}

	return must.Do2(doc.SignChange(coretest.NewTester("alice").Account))
}

func outline(t *testing.T, doc *Document) string {
	t.Helper()

	docpb, err := doc.Hydrate(t.Context())
	require.NoError(t, err)
	require.Empty(t, docpb.DetachedBlocks, "no block may end up detached")

	var walk func(nodes []*documents.BlockNode) string

	walk = func(nodes []*documents.BlockNode) string {
		parts := make([]string, 0, len(nodes))
		for _, n := range nodes {
			s := n.Block.Id
			if sub := walk(n.Children); sub != "" {
				s += "(" + sub + ")"
			}

			parts = append(parts, s)
		}

		return strings.Join(parts, " ")
	}

	return walk(docpb.Content)
}

// storedMoves returns the blocks moved and deleted by the ops stored in the change.
func storedMoves(t *testing.T, c blob.Encoded[*blob.Change]) (moved, deleted []string) {
	t.Helper()

	stored := loadedChange(t, c)
	for op, err := range stored.Ops() {
		require.NoError(t, err)
		switch op := op.(type) {
		case blob.OpMoveBlocks:
			moved = append(moved, op.Blocks...)
		case blob.OpDeleteBlocks:
			deleted = append(deleted, op.Blocks...)
		}
	}

	return moved, deleted
}

// loadedChange decodes the change from its encoded bytes, to look at what is really stored.
func loadedChange(t *testing.T, c blob.Encoded[*blob.Change]) *blob.Change {
	t.Helper()

	decoded := &blob.Change{}
	require.NoError(t, cbornode.DecodeInto(c.Data, decoded))

	return decoded
}

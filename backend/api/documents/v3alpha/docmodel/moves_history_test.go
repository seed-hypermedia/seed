package docmodel

import (
	"fmt"
	"math/rand"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

// These tests cover the moves stored on top of a history: positions left behind by earlier changes,
// blocks that were deleted and restored, branches that were merged. Histories that used to break
// the daemon are written op by op (see rawChange), so they are what the daemons of the time stored,
// no matter what the code under test would store for the same edits today.

// fuzzInt returns the value of an environment variable used to scale the random tests:
//
//	DOCMODEL_FUZZ_SEEDS       number of seeds of every random test (each has its own default).
//	DOCMODEL_FUZZ_OPS         largest number of tree operations per change (default 12).
//	DOCMODEL_FUZZ_OFFTREE     0 to keep the random moves inside of the visible tree (default 1).
//	DOCMODEL_FUZZ_CONCURRENT  0 to skip the histories with concurrent heads (default 1).
func fuzzInt(t *testing.T, name string, def int) int {
	t.Helper()

	v := os.Getenv(name)
	if v == "" {
		return def
	}

	n, err := strconv.Atoi(v)
	require.NoError(t, err, "bad value of %s", name)

	return n
}

// within fails the test if fn doesn't return in time, instead of hanging the whole suite.
func within(t *testing.T, d time.Duration, fn func()) {
	t.Helper()

	done := make(chan any, 1)

	go func() {
		defer func() { done <- recover() }()
		fn()
	}()

	select {
	case p := <-done:
		if p != nil {
			t.Fatalf("panic: %v", p)
		}
	case <-time.After(d):
		t.Fatalf("still running after %s", d)
	}
}

// rawBody collects the ops of a change written by hand.
type rawBody struct {
	doc  *Document
	body blob.ChangeBody
}

// move stores a single move op placing the blocks, one after another, after the left block.
func (b *rawBody) move(parent, left string, blocks ...string) {
	var ref opID

	if left != "" {
		bs, ok := b.doc.crdt.tree.State().blocks[left]
		if !ok || bs.Parent != parent {
			panic("left block " + left + " is not under " + parent)
		}

		ref = bs.Position
	}

	b.body.Ops = append(b.body.Ops, blob.NewOpMoveBlocks(parent, blocks, encodeOpID(ref)))
	b.body.OpCount += len(blocks)
}

func (b *rawBody) put(blocks ...string) {
	for _, blk := range blocks {
		b.body.Ops = append(b.body.Ops, blob.NewOpReplaceBlock(blob.Block{ID_Good: blk, Type: "Paragraph", Text: blk}))
		b.body.OpCount++
	}
}

// rawChange creates a change with exactly the given ops on top of the given changes,
// without going through the code that decides what a mutation has to store.
func rawChange(t *testing.T, changes []blob.Encoded[*blob.Change], build func(b *rawBody)) blob.Encoded[*blob.Change] {
	t.Helper()

	doc := loadFromBytes(t, changes...)
	b := &rawBody{doc: doc}
	build(b)

	ch, err := doc.crdt.prepareChange(doc.crdt.clock.MustNow(), coretest.NewTester("alice").Account, b.body)
	require.NoError(t, err)

	return ch
}

// treeShape returns the visible children of every parent, including the trash
// and the blocks that are not reachable from the document.
func treeShape(doc *Document) map[string][]string {
	st := doc.crdt.tree.State()
	out := map[string][]string{}

	for parent, sub := range st.opSet.sublists.Items() {
		for _, it := range sub.items.Items() {
			if _, ok := st.invisibleMoves.Get(it.ID); ok || it.IsDeleted {
				continue
			}

			out[parent] = append(out[parent], it.Value)
		}
	}

	return out
}

// storedOps describes the ops stored in the change, in their order.
func storedOps(t *testing.T, c blob.Encoded[*blob.Change]) (out []string) {
	t.Helper()

	for op, err := range loadedChange(t, c).Ops() {
		require.NoError(t, err)

		switch op := op.(type) {
		case blob.OpMoveBlocks:
			out = append(out, fmt.Sprintf("move %v under %q", op.Blocks, op.Parent))
		case blob.OpDeleteBlocks:
			out = append(out, fmt.Sprintf("delete %v", op.Blocks))
		case blob.OpReplaceBlock:
			out = append(out, "replace "+op.Block.ID())
		default:
			out = append(out, fmt.Sprintf("%T", op))
		}
	}

	return out
}

// Requests that made the old daemon spin forever: it walked the children lists including the positions
// the blocks had left, so a parent and a child that traded places sent it around in circles.
func TestMoves_OldDaemonHangs(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	t.Run("child moved out, then its parent moved under it, in one request", func(t *testing.T) {
		c1 := rawChange(t, nil, func(b *rawBody) {
			b.move("", "", "x21")
			b.move("x21", "", "x22")
			b.put("x21", "x22")
		})
		require.Equal(t, "x21(x22)", outline(t, loadFromBytes(t, c1)))

		var c2 blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, c1)
			mv(doc, "x22", "", "")
			mv(doc, "x21", "x22", "")
			c2 = must.Do2(doc.SignChange(alice))
		})

		// Not a cycle: by the time x21 goes under x22, x22 is not its child anymore.
		require.Equal(t, "x22(x21)", outline(t, loadFromBytes(t, c1, c2)))
		require.Equal(t, []string{`move [x22] under ""`, `move [x21] under "x22"`}, storedOps(t, c2))
	})

	t.Run("parent and child inverted by earlier changes, then a block appended", func(t *testing.T) {
		changes := []blob.Encoded[*blob.Change]{rawChange(t, nil, func(b *rawBody) {
			b.move("", "", "A", "z")
			b.move("A", "", "B")
			b.put("A", "B", "z")
		})}
		require.Equal(t, "A(B) z", outline(t, loadFromBytes(t, changes...)))

		changes = append(changes, rawChange(t, changes, func(b *rawBody) { b.move("", "A", "B") }))
		require.Equal(t, "A B z", outline(t, loadFromBytes(t, changes...)))

		changes = append(changes, rawChange(t, changes, func(b *rawBody) { b.move("B", "", "A") }))
		require.Equal(t, "B(A) z", outline(t, loadFromBytes(t, changes...)))

		var ch blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, changes...)
			mv(doc, "new", "", "z")
			put(doc, "new")
			ch = must.Do2(doc.SignChange(alice))
		})

		changes = append(changes, ch)
		require.Equal(t, "B(A) z new", outline(t, loadFromBytes(t, changes...)))
		require.Equal(t, []string{`move [new] under ""`, "replace new"}, storedOps(t, ch))
		require.Equal(t, 2, loadedChange(t, ch).Body.OpCount)
	})
}

// The old daemon processed every children list once per position its ancestors ever had,
// so after a few reorders on several levels a one block edit stored the same moves
// over and over: 7 moves, then 196, then megabytes of them.
func TestMoves_NoDuplicatedMovesAfterReorders(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	changes := []blob.Encoded[*blob.Change]{rawChange(t, nil, func(b *rawBody) {
		b.move("", "", "Q", "a", "b")
		b.move("Q", "", "P", "m", "n")
		b.move("P", "", "c", "d")
		b.put("Q", "a", "b", "P", "m", "n", "c", "d")
	})}
	require.Equal(t, "Q(P(c d) m n) a b", outline(t, loadFromBytes(t, changes...)))

	// Reorders on every level, one stored move each, the way they were stored at the time.
	reorders := []struct{ parent, left, block, want string }{
		{"", "b", "a", "Q(P(c d) m n) b a"},
		{"Q", "n", "m", "Q(P(c d) n m) b a"},
		{"P", "d", "c", "Q(P(d c) n m) b a"},
		{"", "", "b", "b Q(P(d c) n m) a"},
		{"Q", "m", "P", "b Q(n m P(d c)) a"},
		{"", "a", "Q", "b a Q(n m P(d c))"},
		{"P", "c", "d", "b a Q(n m P(c d))"},
		{"Q", "", "P", "b a Q(P(c d) n m)"},
	}

	for _, r := range reorders {
		changes = append(changes, rawChange(t, changes, func(b *rawBody) { b.move(r.parent, r.left, r.block) }))
		require.Equal(t, r.want, outline(t, loadFromBytes(t, changes...)))
	}

	t.Run("one new leaf", func(t *testing.T) {
		var ch blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, changes...)
			mv(doc, "new", "P", "c")
			put(doc, "new")
			ch = must.Do2(doc.SignChange(alice))
		})

		require.Equal(t, "b a Q(P(c new d) n m)", outline(t, loadFromBytes(t, append(slices.Clone(changes), ch)...)))
		require.Equal(t, []string{`move [new] under "P"`, "replace new"}, storedOps(t, ch))
		require.Equal(t, 2, loadedChange(t, ch).Body.OpCount)
		require.Less(t, len(ch.Data), 600, "stored change must stay tiny")
	})

	t.Run("one new leaf with every level listed in full", func(t *testing.T) {
		var ch blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, changes...)
			relistOutline(doc, "b a Q(P(c new d) n m)")
			put(doc, "new")
			ch = must.Do2(doc.SignChange(alice))
		})

		require.Equal(t, "b a Q(P(c new d) n m)", outline(t, loadFromBytes(t, append(slices.Clone(changes), ch)...)))
		require.Equal(t, []string{`move [new] under "P"`, "replace new"}, storedOps(t, ch))
		require.Less(t, len(ch.Data), 600, "stored change must stay tiny")
	})

	t.Run("50 edits in a row store one move each", func(t *testing.T) {
		chain := slices.Clone(changes)
		levels := map[string][]string{"": {"b", "a", "Q"}, "Q": {"P", "n", "m"}, "P": {"c", "d"}}
		parents := []string{"", "Q", "P"}

		for i := range 50 {
			parent := parents[i%len(parents)]
			kids := levels[parent]

			var wantOps []string

			if i%2 == 0 {
				// New leaf at the end of the level.
				id := fmt.Sprintf("leaf%d", i)
				kids = append(kids, id)
				wantOps = []string{fmt.Sprintf("move [%s] under %q", id, parent), "replace " + id}
			} else {
				// First block of the level goes to its end.
				kids = append(slices.Clone(kids[1:]), kids[0])
				wantOps = []string{fmt.Sprintf("move [%s] under %q", kids[len(kids)-1], parent)}
			}

			levels[parent] = kids
			want := modelOutline(levels)

			var ch blob.Encoded[*blob.Change]

			within(t, 10*time.Second, func() {
				doc := loadFromBytes(t, chain...)
				// The whole tree is listed again on every edit, like the clients that diff two trees do.
				relistOutline(doc, want)

				if i%2 == 0 {
					put(doc, kids[len(kids)-1])
				}

				ch = must.Do2(doc.SignChange(alice))
			})

			chain = append(chain, ch)
			require.Equal(t, want, outline(t, loadFromBytes(t, chain...)), "edit %d", i)
			require.Equal(t, wantOps, storedOps(t, ch), "edit %d", i)
			require.Equal(t, len(wantOps), loadedChange(t, ch).Body.OpCount, "edit %d", i)
			require.Less(t, len(ch.Data), 600, "edit %d: stored change must stay tiny", i)
		}
	})
}

// A block that was deleted and restored by earlier changes keeps its old position in the trash.
// Its children must not be taken for children of a deleted block: their moves would be stored
// before those of the blocks above them, and a move under a block that is still below
// the moved one is a cycle, which those who apply the change ignore.
func TestMoves_StaleTrashPosition(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	changes := []blob.Encoded[*blob.Change]{buildOutline(t, "P(Q) X(Y)")}

	doc := loadFromBytes(t, changes...)
	must.Do(doc.DeleteBlock("Y"))
	changes = append(changes, must.Do2(doc.SignChange(alice)))
	require.Equal(t, "P(Q) X", outline(t, loadFromBytes(t, changes...)))

	doc = loadFromBytes(t, changes...)
	mv(doc, "Y", "X", "")
	changes = append(changes, must.Do2(doc.SignChange(alice)))
	require.Equal(t, "P(Q) X(Y)", outline(t, loadFromBytes(t, changes...)))

	doc = loadFromBytes(t, changes...)
	mv(doc, "Y", "Q", "")
	mv(doc, "X", "Y", "")
	must.Do(doc.DeleteBlock("P"))
	ch := must.Do2(doc.SignChange(alice))
	changes = append(changes, ch)

	got := loadFromBytes(t, changes...)
	require.Empty(t, outline(t, got), "stored ops: %v", storedOps(t, ch))

	shape := treeShape(got)
	require.Equal(t, []string{"Q"}, shape["P"])
	require.Equal(t, []string{"Y"}, shape["Q"])
	require.Equal(t, []string{"X"}, shape["Y"])
	require.Equal(t, []string{`delete [P]`, `move [Y] under "Q"`, `move [X] under "Y"`}, storedOps(t, ch))
}

// Moves are stored top down everywhere, not only in the visible document:
// a move under a block is only valid once the blocks above that block are where they end up.
func TestMoves_ParentsBeforeChildrenOutsideOfTheDocument(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account

	// Blocks get the names that used to be processed in the wrong order: "A" sorts before "B".
	invert := func(doc *Document) {
		mv(doc, "B", "c", "")
		mv(doc, "A", "B", "")
	}

	t.Run("under a block whose only move is a cycle", func(t *testing.T) {
		base := buildOutline(t, "c(A(B)) z")

		// D only has its content, no position.
		doc := loadFromBytes(t, base)
		put(doc, "D")
		detached := must.Do2(doc.SignChange(alice))

		// Two concurrent changes: c under D, and D under c. The later one makes a cycle and is ignored,
		// so D never gets a position, and c with everything below it is not reachable from anywhere.
		ts := detached.Decoded.Ts

		doc = loadFromBytes(t, base, detached)
		mv(doc, "c", "D", "")
		brA := must.Do2(doc.SignChangeAt(alice, ts.Add(10*time.Millisecond)))

		doc = loadFromBytes(t, base, detached)
		mv(doc, "D", "c", "")
		brB := must.Do2(doc.SignChangeAt(bob, ts.Add(20*time.Millisecond)))

		changes := []blob.Encoded[*blob.Change]{base, detached, brA, brB}

		merged := loadFromBytes(t, changes...)
		require.Equal(t, map[string][]string{"": {"z"}, "D": {"c"}, "c": {"A"}, "A": {"B"}}, treeShape(merged))
		require.NotContains(t, merged.crdt.tree.State().blocks, "D", "D must have no position")

		invert(merged)
		ch := must.Do2(merged.SignChange(alice))
		changes = append(changes, ch)

		require.Equal(t, map[string][]string{"": {"z"}, "D": {"c"}, "c": {"B"}, "B": {"A"}}, treeShape(loadFromBytes(t, changes...)), "stored ops: %v", storedOps(t, ch))
		require.Equal(t, []string{`move [B] under "c"`, `move [A] under "B"`}, storedOps(t, ch))
	})

	t.Run("under a block that has content but was never moved", func(t *testing.T) {
		doc := must.Do2(New("mydoc", cclock.New()))
		put(doc, "D")
		mv(doc, "z", "", "")
		mv(doc, "c", "D", "")
		mv(doc, "A", "c", "")
		mv(doc, "B", "A", "")
		put(doc, "z")
		put(doc, "c")
		put(doc, "A")
		put(doc, "B")
		base := must.Do2(doc.SignChange(alice))
		require.Equal(t, map[string][]string{"": {"z"}, "D": {"c"}, "c": {"A"}, "A": {"B"}}, treeShape(loadFromBytes(t, base)))

		doc = loadFromBytes(t, base)
		invert(doc)
		ch := must.Do2(doc.SignChange(alice))

		require.Equal(t, map[string][]string{"": {"z"}, "D": {"c"}, "c": {"B"}, "B": {"A"}}, treeShape(loadFromBytes(t, base, ch)), "stored ops: %v", storedOps(t, ch))
		require.Equal(t, []string{`move [B] under "c"`, `move [A] under "B"`}, storedOps(t, ch))
	})

	t.Run("under a block created and deleted in the same change", func(t *testing.T) {
		base := buildOutline(t, "c(A(B)) z")

		doc := loadFromBytes(t, base)
		mv(doc, "D", "", "z")
		put(doc, "D")
		mv(doc, "c", "D", "")
		invert(doc)
		must.Do(doc.DeleteBlock("D"))
		ch := must.Do2(doc.SignChange(alice))

		got := loadFromBytes(t, base, ch)
		require.Equal(t, "z", outline(t, got))
		// D itself is not stored: it never existed for anyone else. What was moved under it is gone with it.
		require.Equal(t, map[string][]string{"": {"z"}, "D": {"c"}, "c": {"B"}, "B": {"A"}}, treeShape(got), "stored ops: %v", storedOps(t, ch))
		require.Equal(t, []string{`move [c] under "D"`, `move [B] under "c"`, `move [A] under "B"`}, storedOps(t, ch))
	})
}

// A block whose content is written after the first move of the request must be a valid parent
// for the moves that follow, just like the one written before it.
func TestMoves_NewParentAfterFirstMove(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	c1 := buildOutline(t, "a b")

	doc := loadFromBytes(t, c1)
	put(doc, "x1")
	mv(doc, "x1", "a", "")
	put(doc, "P")
	put(doc, "c")
	mv(doc, "c", "P", "")
	mv(doc, "P", "", "b")
	c2 := must.Do2(doc.SignChange(alice))

	require.Equal(t, "a(x1) b P(c)", outline(t, loadFromBytes(t, c1, c2)))
	require.Equal(t, []string{
		`move [P] under ""`, `move [x1] under "a"`, `move [c] under "P"`,
		"replace P", "replace c", "replace x1",
	}, storedOps(t, c2))

	// The parent may also stay without a position: its children are then detached with it.
	doc = loadFromBytes(t, c1, c2)
	mv(doc, "y", "", "")
	put(doc, "y")
	put(doc, "D")
	mv(doc, "d1", "D", "")
	put(doc, "d1")
	c3 := must.Do2(doc.SignChange(alice))

	got := loadFromBytes(t, c1, c2, c3)
	docpb := must.Do2(got.Hydrate(t.Context()))
	require.Len(t, docpb.Content, 4)
	require.Contains(t, docpb.DetachedBlocks, "D")
	require.Len(t, docpb.DetachedBlocks["D"].Children, 1)
	require.Equal(t, "d1", docpb.DetachedBlocks["D"].Children[0].Block.Id)
}

// Turning [a, [b]] into [b, [a]] in one request.
func TestMoves_SwapParentAndChild(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	c1 := buildOutline(t, "a(b) z")

	t.Run("child first", func(t *testing.T) {
		var c2 blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, c1)
			mv(doc, "b", "", "")
			mv(doc, "a", "b", "")
			c2 = must.Do2(doc.SignChange(alice))
		})

		require.Equal(t, "b(a) z", outline(t, loadFromBytes(t, c1, c2)))
		require.Equal(t, []string{`move [b] under ""`, `move [a] under "b"`}, storedOps(t, c2))

		// And back.
		var c3 blob.Encoded[*blob.Change]

		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, c1, c2)
			mv(doc, "a", "", "")
			mv(doc, "b", "a", "")
			c3 = must.Do2(doc.SignChange(alice))
		})

		require.Equal(t, "a(b) z", outline(t, loadFromBytes(t, c1, c2, c3)))
	})

	// The parent can't go under its own child: every move of a request must be valid when it's made.
	// The request is refused, and the document stays usable.
	t.Run("parent first", func(t *testing.T) {
		within(t, 10*time.Second, func() {
			doc := loadFromBytes(t, c1)
			err := doc.MoveBlock("a", "b", "")
			require.ErrorContains(t, err, "cycle detected")

			// Nothing was changed by the refused move.
			mv(doc, "b", "", "a")
			c2 := must.Do2(doc.SignChange(alice))
			require.Equal(t, "a b z", outline(t, loadFromBytes(t, c1, c2)))
		})
	})
}

// A level of a few thousand blocks has to be handled in about the time it takes to read it.
// The bounds are far above what's needed, only to catch the work growing with the square of the level.
func TestMoves_LargeLevel(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	const n = 6000

	ids := make([]string, n)
	for i := range ids {
		ids[i] = fmt.Sprintf("b%05d", i)
	}

	var base blob.Encoded[*blob.Change]

	within(t, 30*time.Second, func() {
		doc := must.Do2(New("mydoc", cclock.New()))
		relist(doc, "", ids...)
		base = must.Do2(doc.SignChange(alice))
	})

	cases := map[string]struct {
		order     func() []string
		wantMoves int
	}{
		"single insert in the middle": {
			order: func() []string {
				return slices.Concat(ids[:n/2], []string{"new"}, ids[n/2:])
			},
			wantMoves: 1,
		},
		"first block to the end": {
			order:     func() []string { return slices.Concat(ids[1:], ids[:1]) },
			wantMoves: 1,
		},
		"reverse": {
			order: func() []string {
				o := slices.Clone(ids)
				slices.Reverse(o)

				return o
			},
			wantMoves: n - 1,
		},
		"shuffle": {
			order: func() []string {
				o := slices.Clone(ids)
				rand.New(rand.NewSource(1)).Shuffle(n, func(i, j int) { o[i], o[j] = o[j], o[i] }) //nolint:gosec // Deterministic test input.

				return o
			},
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			order := tc.order()

			var ch blob.Encoded[*blob.Change]

			start := time.Now()

			within(t, 30*time.Second, func() {
				doc := loadFromBytes(t, base)
				// The whole level is listed, block after block.
				relist(doc, "", order...)
				ch = must.Do2(doc.SignChange(alice))
			})

			moved, deleted := storedMoves(t, ch)
			t.Logf("%d blocks: %s, %d moves stored, %d bytes", n, time.Since(start), len(moved), len(ch.Data))

			require.Equal(t, order, treeShape(loadFromBytes(t, base, ch))[""])
			require.Empty(t, deleted)
			require.Len(t, uniq(moved), len(moved), "block moved more than once")

			if tc.wantMoves > 0 {
				require.Len(t, moved, tc.wantMoves)
			} else {
				require.Less(t, len(moved), n)
			}
		})
	}
}

// historyModel is the tree as the simplest possible implementation sees it, including the trash
// and the blocks that are not reachable from the document.
type historyModel struct {
	children map[string][]string
	parent   map[string]string
	// Blocks that have no position, but can have children.
	roots []string
	n     *int
	// Prefix of the blocks created by the current branch.
	prefix string
}

func newHistoryModel(doc *Document) *historyModel {
	m := &historyModel{children: treeShape(doc), parent: map[string]string{}}

	for parent, kids := range m.children {
		for _, c := range kids {
			if _, ok := m.parent[c]; ok {
				panic("block " + c + " has more than one visible position")
			}

			m.parent[c] = parent
		}
	}

	for blk := range doc.crdt.tree.sublists.Keys() {
		if _, ok := m.parent[blk]; !ok && blk != "" && blk != TrashNodeID {
			m.roots = append(m.roots, blk)
		}
	}

	return m
}

func (m *historyModel) isAncestorOrSelf(a, b string) bool {
	for steps := 0; steps <= len(m.parent); steps++ {
		if a == b {
			return true
		}

		p, ok := m.parent[b]
		if !ok || p == "" || p == TrashNodeID {
			return false
		}

		b = p
	}

	panic("cycle in the model")
}

func (m *historyModel) isVisible(b string) bool {
	for steps := 0; steps <= len(m.parent); steps++ {
		p, ok := m.parent[b]
		if !ok || p == TrashNodeID {
			return false
		}

		if p == "" {
			return true
		}

		b = p
	}

	panic("cycle in the model")
}

func (m *historyModel) detach(b string) {
	if p, ok := m.parent[b]; ok {
		m.children[p] = slices.DeleteFunc(m.children[p], func(s string) bool { return s == b })
	}
}

// randomOp applies a random valid operation to the document and to the model.
// Unlike [treeModel.randomOp] it also deletes blocks that are not visible, moves blocks
// under deleted and detached blocks (when offTree is set), and creates blocks that have no position.
func (m *historyModel) randomOp(rng *rand.Rand, doc *Document, offTree bool) (desc string, err error) {
	known := slices.Sorted(func(yield func(string) bool) {
		for b := range m.parent {
			if !yield(b) {
				return
			}
		}
	})

	if len(known) > 0 && rng.Intn(6) == 0 {
		b := known[rng.Intn(len(known))]
		if err := doc.DeleteBlock(b); err != nil {
			return "delete " + b, err
		}

		if m.parent[b] != TrashNodeID {
			m.detach(b)
			m.parent[b] = TrashNodeID
			m.children[TrashNodeID] = append(m.children[TrashNodeID], b)
		}

		return "delete " + b, nil
	}

	newBlock := func() string {
		*m.n++
		return fmt.Sprintf("%s%d", m.prefix, *m.n)
	}

	// A block that only has content. It may get children, and a position, later.
	if offTree && rng.Intn(12) == 0 {
		b := newBlock()
		m.roots = append(m.roots, b)

		return "put " + b, doc.ReplaceBlock(&documents.Block{Id: b, Type: "Paragraph", Text: b})
	}

	var (
		block string
		isNew bool
	)

	switch {
	case offTree && len(m.roots) > 0 && rng.Intn(8) == 0:
		block = m.roots[rng.Intn(len(m.roots))]
	case len(known) > 0 && rng.Intn(4) != 0:
		block = known[rng.Intn(len(known))]
	default:
		block = newBlock()
		isNew = true
	}

	parents := []string{"", ""}

	for _, p := range known {
		if m.isAncestorOrSelf(block, p) {
			continue
		}

		if offTree || m.isVisible(p) {
			parents = append(parents, p)
		}
	}

	if offTree {
		for _, p := range m.roots {
			if !m.isAncestorOrSelf(block, p) {
				parents = append(parents, p)
			}
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
	desc = fmt.Sprintf("move %s parent=%q left=%q", block, parent, left)

	// The content of a new block is written before or after its move.
	putFirst := isNew && rng.Intn(2) == 0
	if putFirst {
		desc = "put+" + desc
		if err := doc.ReplaceBlock(&documents.Block{Id: block, Type: "Paragraph", Text: block}); err != nil {
			return desc, err
		}
	}

	if err := doc.MoveBlock(block, parent, left); err != nil {
		return desc, err
	}

	if isNew && !putFirst {
		if err := doc.ReplaceBlock(&documents.Block{Id: block, Type: "Paragraph", Text: block}); err != nil {
			return desc, err
		}
	}

	m.detach(block)
	m.roots = slices.DeleteFunc(m.roots, func(s string) bool { return s == block })
	m.parent[block] = parent
	idx := slices.Index(m.children[parent], left) + 1
	m.children[parent] = slices.Insert(m.children[parent], idx, block)

	return desc, nil
}

// compare checks the tree read back against the model.
func (m *historyModel) compare(got *historyModel) error {
	for b, p := range m.parent {
		gp, ok := got.parent[b]
		if !ok {
			// Blocks created and deleted in the same change are not stored at all.
			if p != TrashNodeID {
				return fmt.Errorf("block %s is missing, want it under %q", b, p)
			}

			continue
		}

		if gp != p {
			return fmt.Errorf("block %s is under %q, want it under %q", b, gp, p)
		}
	}

	for b := range got.parent {
		if _, ok := m.parent[b]; !ok {
			return fmt.Errorf("unexpected block %s", b)
		}
	}

	for _, k := range uniq(slices.Concat(slices.Collect(mapKeys(m.children)), slices.Collect(mapKeys(got.children)))) {
		// The order of the trash means nothing.
		if k == TrashNodeID {
			continue
		}

		if !slices.Equal(m.children[k], got.children[k]) {
			return fmt.Errorf("children of %q are %v, want %v", k, got.children[k], m.children[k])
		}
	}

	return nil
}

func mapKeys[V any](m map[string]V) func(yield func(string) bool) {
	return func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	}
}

func loadChanges(changes ...blob.Encoded[*blob.Change]) (*Document, error) {
	doc, err := New("mydoc", cclock.New())
	if err != nil {
		return nil, err
	}

	for _, c := range changes {
		decoded := &blob.Change{}
		if err := cbornode.DecodeInto(c.Data, decoded); err != nil {
			return nil, err
		}

		if err := doc.ApplyChange(c.CID, decoded); err != nil {
			return nil, err
		}
	}

	return doc, nil
}

// historyRound makes a change of random operations on top of the given changes,
// and checks what is read back from the encoded bytes.
func historyRound(t *testing.T, rng *rand.Rand, kp *core.KeyPair, n *int, prefix string, nOps int, offTree bool, changes []blob.Encoded[*blob.Change]) (ch blob.Encoded[*blob.Change], info string, err error) {
	doc, err := loadChanges(changes...)
	if err != nil {
		return ch, "", fmt.Errorf("load: %w", err)
	}

	model := newHistoryModel(doc)
	model.n = n
	model.prefix = prefix
	info = fmt.Sprintf("before=%v", model.children)

	var log []string

	for range nOps {
		desc, err := model.randomOp(rng, doc, offTree)
		log = append(log, desc)

		if err != nil {
			return ch, fmt.Sprintf("%s ops=%v", info, log), fmt.Errorf("refused operation: %w", err)
		}
	}

	info = fmt.Sprintf("%s ops=%v", info, log)

	ch, err = doc.SignChange(kp)
	if err != nil {
		return ch, info, fmt.Errorf("sign: %w", err)
	}

	info = fmt.Sprintf("%s stored=%v", info, storedOps(t, ch))

	all := append(slices.Clone(changes), ch)

	re, err := loadChanges(all...)
	if err != nil {
		return ch, info, fmt.Errorf("reload: %w", err)
	}

	if err := model.compare(newHistoryModel(re)); err != nil {
		return ch, info, err
	}

	if _, err := re.Hydrate(t.Context()); err != nil {
		return ch, info, fmt.Errorf("hydrate: %w", err)
	}

	moved, deleted := storedMoves(t, ch)
	if len(uniq(moved)) != len(moved) || len(uniq(deleted)) != len(deleted) {
		return ch, info, fmt.Errorf("block moved or deleted more than once")
	}

	// Listing every level again, as it is, must not store anything.
	again, err := loadChanges(all...)
	if err != nil {
		return ch, info, err
	}

	for parent, kids := range model.children {
		if parent == TrashNodeID {
			continue
		}

		var left string

		for _, c := range kids {
			if err := again.MoveBlock(c, parent, left); err != nil {
				return ch, info, fmt.Errorf("re-listing %q: %w", parent, err)
			}

			left = c
		}
	}

	noop, err := again.SignChange(kp)
	if err != nil {
		return ch, info, fmt.Errorf("sign re-listing: %w", err)
	}

	if len(noop.Decoded.Body.Ops) != 0 {
		return ch, info, fmt.Errorf("re-listing the result stored %v", storedOps(t, noop))
	}

	return ch, info, nil
}

// TestMoves_RandomHistory makes random changes on top of random histories, including histories
// with two branches that are merged, and compares what is read back from the encoded bytes
// with the model. It's the test to scale up when touching the way moves are stored:
//
//	DOCMODEL_FUZZ_SEEDS=20000 DOCMODEL_FUZZ_OPS=40 go test ./backend/api/documents/v3alpha/docmodel -run TestMoves_RandomHistory
func TestMoves_RandomHistory(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account

	var (
		seeds      = fuzzInt(t, "DOCMODEL_FUZZ_SEEDS", 400)
		maxOps     = fuzzInt(t, "DOCMODEL_FUZZ_OPS", 12)
		offTree    = fuzzInt(t, "DOCMODEL_FUZZ_OFFTREE", 1) == 1
		concurrent = fuzzInt(t, "DOCMODEL_FUZZ_CONCURRENT", 1) == 1
	)

	for seed := range seeds {
		rng := rand.New(rand.NewSource(int64(seed))) //nolint:gosec // Deterministic test input.

		// rounds makes a few changes in a row on top of the given ones.
		rounds := func(stage string, kp *core.KeyPair, prefix string, count int, changes []blob.Encoded[*blob.Change]) (made []blob.Encoded[*blob.Change]) {
			var n int

			for round := range count {
				nOps := 1 + rng.Intn(maxOps)
				if len(changes) == 0 && round == 0 {
					nOps += 4
				}

				ch, info, err := historyRound(t, rng, kp, &n, prefix, nOps, offTree, slices.Concat(changes, made))
				require.NoError(t, err, "seed=%d stage=%s round=%d %s", seed, stage, round, info)

				made = append(made, ch)
			}

			return made
		}

		base := rounds("linear", alice, "n", 3, nil)

		if !concurrent {
			continue
		}

		// Two branches on top of the same changes, then changes on top of both.
		onlyA := rounds("branch A", alice, "a", 1+rng.Intn(2), base)
		onlyB := rounds("branch B", bob, "b", 1+rng.Intn(2), base)

		merged := slices.Concat(base, onlyA, onlyB)
		rounds("merged", alice, "m", 3, merged)

		// The branches give the same tree no matter which one is applied first.
		x, err := loadChanges(merged...)
		require.NoError(t, err, "seed=%d", seed)

		y, err := loadChanges(slices.Concat(base, onlyB, onlyA)...)
		require.NoError(t, err, "seed=%d", seed)

		require.Equal(t, treeShape(x), treeShape(y), "seed=%d: branches applied in different orders", seed)
	}
}

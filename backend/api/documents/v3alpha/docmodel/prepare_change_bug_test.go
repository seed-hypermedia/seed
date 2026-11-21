package docmodel

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/must"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

// Reproductions of https://github.com/seed-hypermedia/seed/issues/1382: on documents whose history
// reordered blocks, PrepareChange (and every other path through blockTreeMutation.Commit) either never
// returns or stores the same moves many times over. The web editor hits both in production.
//
// They fail on main, so they are skipped unless SEED_RUN_KNOWN_BUGS=1:
//
//	SEED_RUN_KNOWN_BUGS=1 go test ./backend/api/documents/v3alpha/docmodel -run TestBug_PrepareChange -count=1 -v
//
// The fix (#1375) makes them pass; it should drop the skip.
func skipKnownPrepareChangeBug(t *testing.T) {
	t.Helper()

	if os.Getenv("SEED_RUN_KNOWN_BUGS") != "1" {
		t.Skip("known bug https://github.com/seed-hypermedia/seed/issues/1382 (fix: #1375); set SEED_RUN_KNOWN_BUGS=1 to run")
	}
}

// TestBug_PrepareChangeHangsOnInvertedHistory: earlier changes put a block under its former child.
// Appending one root block then makes Commit walk the children lists including positions the blocks
// have left, and it goes around in circles. The daemon's PrepareChange handler never answers.
func TestBug_PrepareChangeHangsOnInvertedHistory(t *testing.T) {
	skipKnownPrepareChangeBug(t)

	alice := coretest.NewTester("alice").Account

	changes := []blob.Encoded[*blob.Change]{reproRawChange(t, nil, func(b *reproBody) {
		b.move("", "", "A", "z")
		b.move("A", "", "B")
		b.put("A", "B", "z")
	})}
	require.Equal(t, "A(B) z", reproOutline(t, loadFromBytes(t, changes...)))

	changes = append(changes, reproRawChange(t, changes, func(b *reproBody) { b.move("", "A", "B") }))
	require.Equal(t, "A B z", reproOutline(t, loadFromBytes(t, changes...)))

	changes = append(changes, reproRawChange(t, changes, func(b *reproBody) { b.move("B", "", "A") }))
	require.Equal(t, "B(A) z", reproOutline(t, loadFromBytes(t, changes...)))

	var ch blob.Encoded[*blob.Change]

	reproWithin(t, 10*time.Second, func() {
		doc := loadFromBytes(t, changes...)
		reproMove(doc, "new", "", "z")
		reproPut(doc, "new")
		ch = must.Do2(doc.SignChange(alice))
	})

	require.Equal(t, "B(A) z new", reproOutline(t, loadFromBytes(t, append(changes, ch)...)))
	require.Equal(t, []string{`move [new] under ""`, "replace new"}, reproStoredOps(t, ch))
}

// TestBug_PrepareChangeDuplicatesMovesAfterReorders: after a few reorders on nested levels, Commit
// processes each children list once per position its ancestors ever had, so adding one leaf stores
// the same moves again and again (7, then 196, then megabytes as the history grows).
func TestBug_PrepareChangeDuplicatesMovesAfterReorders(t *testing.T) {
	skipKnownPrepareChangeBug(t)

	alice := coretest.NewTester("alice").Account

	changes := []blob.Encoded[*blob.Change]{reproRawChange(t, nil, func(b *reproBody) {
		b.move("", "", "Q", "a", "b")
		b.move("Q", "", "P", "m", "n")
		b.move("P", "", "c", "d")
		b.put("Q", "a", "b", "P", "m", "n", "c", "d")
	})}
	require.Equal(t, "Q(P(c d) m n) a b", reproOutline(t, loadFromBytes(t, changes...)))

	// One stored move per reorder, the way the daemons of the time stored them.
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
		changes = append(changes, reproRawChange(t, changes, func(b *reproBody) { b.move(r.parent, r.left, r.block) }))
		require.Equal(t, r.want, reproOutline(t, loadFromBytes(t, changes...)))
	}

	var ch blob.Encoded[*blob.Change]

	reproWithin(t, 10*time.Second, func() {
		doc := loadFromBytes(t, changes...)
		reproMove(doc, "new", "P", "c")
		reproPut(doc, "new")
		ch = must.Do2(doc.SignChange(alice))
	})

	require.Equal(t, "b a Q(P(c new d) n m)", reproOutline(t, loadFromBytes(t, append(changes, ch)...)))
	require.Equal(t, []string{`move [new] under "P"`, "replace new"}, reproStoredOps(t, ch), "one new leaf must store one move")
	require.Less(t, len(ch.Data), 600, "the stored change must stay tiny")
}

// reproBody collects the ops of a change written by hand, so a history is exactly what older daemons stored.
type reproBody struct {
	doc  *Document
	body blob.ChangeBody
}

// move stores one move op placing the blocks, one after another, after the left block.
func (b *reproBody) move(parent, left string, blocks ...string) {
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

func (b *reproBody) put(blocks ...string) {
	for _, blk := range blocks {
		b.body.Ops = append(b.body.Ops, blob.NewOpReplaceBlock(blob.Block{ID_Good: blk, Type: "Paragraph", Text: blk}))
		b.body.OpCount++
	}
}

func reproRawChange(t *testing.T, changes []blob.Encoded[*blob.Change], build func(b *reproBody)) blob.Encoded[*blob.Change] {
	t.Helper()

	doc := loadFromBytes(t, changes...)
	b := &reproBody{doc: doc}
	build(b)

	ch, err := doc.crdt.prepareChange(doc.crdt.clock.MustNow(), coretest.NewTester("alice").Account, b.body)
	require.NoError(t, err)

	return ch
}

func reproMove(doc *Document, block, parent, left string) {
	must.Do(doc.MoveBlock(block, parent, left))
}

func reproPut(doc *Document, block string) {
	must.Do(doc.ReplaceBlock(&documents.Block{Id: block, Type: "Paragraph", Text: block}))
}

// reproWithin fails the test if fn doesn't return in time, instead of hanging the suite.
func reproWithin(t *testing.T, d time.Duration, fn func()) {
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
		t.Fatalf("still running after %s: the change was never prepared", d)
	}
}

// reproOutline renders the document as "a b(b1 b2) c".
func reproOutline(t *testing.T, doc *Document) string {
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

// reproStoredOps describes the ops stored in the encoded change, in their order.
func reproStoredOps(t *testing.T, c blob.Encoded[*blob.Change]) (out []string) {
	t.Helper()

	decoded := &blob.Change{}
	require.NoError(t, cbornode.DecodeInto(c.Data, decoded))

	for op, err := range decoded.Ops() {
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

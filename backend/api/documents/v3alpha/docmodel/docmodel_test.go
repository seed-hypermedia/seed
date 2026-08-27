package docmodel

import (
	"fmt"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDocmodelSmoke(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.SetMetadata("title", "Hello"))
	must.Do(doc.MoveBlock("b1", "", ""))
	must.Do(doc.MoveBlock("b2", "", "b1"))
	must.Do(doc.MoveBlock("b3", "", "b2"))
	must.Do(doc.MoveBlock("b1.1", "b1", ""))
	c1 := must.Do2(doc.SignChange(alice))

	want := &blob.Change{
		Body: blob.ChangeBody{
			OpCount: 5,
			Ops: []blob.OpMap{
				{
					"blocks": []any{"b1", "b2", "b3"},
					"type":   "MoveBlocks",
				},
				{
					"blocks": []any{"b1.1"},
					"parent": "b1",
					"type":   "MoveBlocks",
				},
				{
					"type": "SetAttributes",
					"attrs": []any{
						map[string]any{"key": []any{"title"}, "value": "Hello"},
					},
				},
			},
		},
	}

	require.Equal(t, want.Body, c1.Decoded.Body)

	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
		must.Do(doc.SetMetadata("title", "Hello world"))
		must.Do(doc.DeleteBlock("b1.1"))
		must.Do(doc.MoveBlock("b4", "", ""))
		must.Do(doc.DeleteBlock("b3"))
		c2 := must.Do2(doc.SignChange(alice))

		{
			doc := must.Do2(New("mydoc", cclock.New()))
			must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
			must.Do(doc.ApplyChange(c2.CID, c2.Decoded))

			require.Equal(t, map[string]any{"title": "Hello world"}, doc.crdt.GetMetadata())
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks["b1.1"].Parent, "deleted block b1.1 must be in trash")
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks["b3"].Parent, "deleted block b3 must be in trash")
		}
	}
}

func TestFirstContentImage(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	load := func(c blob.Encoded[*blob.Change]) *Document {
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c.CID, c.Decoded))
		return doc
	}

	t.Run("returns first image in reading order", func(t *testing.T) {
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.MoveBlock("p1", "", ""))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "p1", Type: "Paragraph", Text: "intro"}))
		must.Do(doc.MoveBlock("img1", "", "p1"))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "img1", Type: "Image", Link: "ipfs://first"}))
		must.Do(doc.MoveBlock("img2", "", "img1"))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "img2", Type: "Image", Link: "ipfs://second"}))

		require.Equal(t, "ipfs://first", load(must.Do2(doc.SignChange(alice))).FirstContentImage())
	})

	t.Run("reading order wins over creation order", func(t *testing.T) {
		doc := must.Do2(New("mydoc", cclock.New()))
		// The bottom image block is created first, then a second image is
		// inserted above it. Reading order must return the top one.
		must.Do(doc.MoveBlock("bottom", "", ""))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "bottom", Type: "Image", Link: "ipfs://bottom"}))
		must.Do(doc.MoveBlock("top", "", "")) // left sibling "" => first position
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "top", Type: "Image", Link: "ipfs://top"}))

		require.Equal(t, "ipfs://top", load(must.Do2(doc.SignChange(alice))).FirstContentImage())
	})

	t.Run("no image returns empty", func(t *testing.T) {
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.MoveBlock("p1", "", ""))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "p1", Type: "Paragraph", Text: "no images"}))

		require.Equal(t, "", load(must.Do2(doc.SignChange(alice))).FirstContentImage())
	})

	t.Run("image without a link is skipped", func(t *testing.T) {
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.MoveBlock("empty", "", ""))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "empty", Type: "Image", Link: ""}))
		must.Do(doc.MoveBlock("real", "", "empty"))
		must.Do(doc.ReplaceBlock(&documents.Block{Id: "real", Type: "Image", Link: "ipfs://real"}))

		require.Equal(t, "ipfs://real", load(must.Do2(doc.SignChange(alice))).FirstContentImage())
	})
}

func TestMetadataStructuralReplacementDoesNotResurrectAncestors(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account
	load := func(changes ...blob.Encoded[*blob.Change]) *Document {
		doc := must.Do2(New("mydoc", cclock.New()))
		for _, change := range changes {
			must.Do(doc.ApplyChange(change.CID, change.Decoded))
		}
		return doc
	}

	doc := load()
	must.Do(doc.SetAttribute("", []string{"theme"}, "Legacy"))
	parent := must.Do2(doc.SignChange(alice))

	doc = load(parent)
	must.Do(doc.SetAttribute("", []string{"theme", "Color"}, "Red"))
	child := must.Do2(doc.SignChange(alice))
	require.Equal(t, map[string]any{"theme": map[string]any{"Color": "Red"}}, doc.crdt.GetMetadata())

	doc = load(parent, child)
	must.Do(doc.SetAttribute("", []string{"theme", "Color"}, nil))
	deletedChild := must.Do2(doc.SignChange(alice))
	require.Empty(t, doc.crdt.GetMetadata())

	doc = load(parent, child, deletedChild)
	require.Empty(t, doc.crdt.GetMetadata(), "deleting a child must not resurrect the scalar parent it replaced")
	require.Equal(t, 1, doc.crdt.stateMetadata.Len(), "only the winning child tombstone must remain")
}

func TestBug_RedundantReplaces(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))

	must.Do(doc.MoveBlock("mxH", "", ""))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "mxH",
		Type: "Paragraph",
		Text: "1",
	}))

	must.Do(doc.MoveBlock("HLI", "", "mxH"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "HLI",
		Type: "Paragraph",
		Text: "2",
	}))

	must.Do(doc.MoveBlock("mMa", "", "HLI"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "mMa",
		Type: "Paragraph",
		Text: "3",
	}))

	c1, err := doc.SignChange(alice)
	require.NoError(t, err)

	var c2 blob.Encoded[*blob.Change]
	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))

		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "mxH",
			Type: "Paragraph",
			Text: "1",
		}))

		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "HLI",
			Type: "Paragraph",
			Text: "3.",
		}))

		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "mMa",
			Type: "Paragraph",
			Text: "3",
		}))

		c2, err = doc.SignChange(alice)
		require.NoError(t, err)
	}

	require.Len(t, c2.Decoded.Body.Ops, 1)
	require.Equal(t, c2.Decoded.Body.OpCount, 1)

	for op, err := range c2.Decoded.Ops() {
		require.NoError(t, err)
		replace, ok := op.(blob.OpReplaceBlock)
		if ok && replace.Block.ID() == "mxH" {
			t.Fatalf("REDUNDANT REPLACE FOUND")
		}
	}
}

func TestBug_BlockReordering(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))

	must.Do(doc.MoveBlock("mxH", "", ""))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "mxH",
		Type: "Paragraph",
		Text: "1",
	}))

	must.Do(doc.MoveBlock("HLI", "", "mxH"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "HLI",
		Type: "Paragraph",
		Text: "3",
	}))

	must.Do(doc.MoveBlock("mMa", "", "HLI"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "mMa",
		Type: "Paragraph",
		Text: "2",
	}))

	must.Do(doc.MoveBlock("ZmN", "", "mMa"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "ZmN",
		Type: "Paragraph",
		Text: "4",
	}))

	must.Do(doc.MoveBlock("SqI", "", "ZmN"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "SqI",
		Type: "Paragraph",
		Text: "5",
	}))

	c1, err := doc.SignChange(alice)
	require.NoError(t, err)

	var c2 blob.Encoded[*blob.Change]
	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))

		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "mxH",
			Type: "Paragraph",
			Text: "1",
		}))

		must.Do(doc.MoveBlock("OONM", "", "mxH"))
		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "OONM",
			Type: "Paragraph",
			Text: "2",
		}))

		must.Do(doc.MoveBlock("HLI", "", "OONM"))
		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "HLI",
			Type: "Paragraph",
			Text: "3",
		}))

		must.Do(doc.MoveBlock("ZmN", "", "HLI"))

		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "ZmN",
			Type: "Paragraph",
			Text: "4",
		}))
		must.Do(doc.ReplaceBlock(&documents.Block{
			Id:   "SqI",
			Type: "Paragraph",
			Text: "5",
		}))

		must.Do(doc.DeleteBlock("mMa"))

		c2, err = doc.SignChange(alice)
		require.NoError(t, err)
	}

	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
		must.Do(doc.ApplyChange(c2.CID, c2.Decoded))

		hdoc, err := doc.Hydrate(t.Context())
		require.NoError(t, err)

		want := [][2]string{
			{"mxH", "1"},
			{"OONM", "2"},
			{"HLI", "3"},
			{"ZmN", "4"},
			{"SqI", "5"},
		}

		require.Len(t, hdoc.Content, len(want))

		for i, blk := range hdoc.Content {
			require.Equal(t, want[i], [2]string{blk.Block.Id, blk.Block.Text})
		}
	}
}

func TestBug_HydratePreservesStructuralParentWithoutBlockState(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))

	must.Do(doc.MoveBlock("table", "", ""))

	must.Do(doc.MoveBlock("row", "table", ""))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "row",
		Type: "TableRow",
	}))

	must.Do(doc.MoveBlock("after", "", "table"))
	must.Do(doc.ReplaceBlock(&documents.Block{
		Id:   "after",
		Type: "Paragraph",
		Text: "after table",
	}))

	c1 := must.Do2(doc.SignChange(alice))

	doc = must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.ApplyChange(c1.CID, c1.Decoded))

	hdoc, err := doc.Hydrate(t.Context())
	require.NoError(t, err)
	require.Len(t, hdoc.Content, 2)

	require.Equal(t, "table", hdoc.Content[0].Block.Id)
	require.Empty(t, hdoc.Content[0].Block.Type)
	require.Empty(t, hdoc.Content[0].Block.Text)
	require.Len(t, hdoc.Content[0].Children, 1)
	require.Equal(t, "row", hdoc.Content[0].Children[0].Block.Id)

	require.Equal(t, "after", hdoc.Content[1].Block.Id)
}

func TestApplyChangeOpIndexOverflow(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	// A multi-block op advances the op ID index quadratically per block, so a
	// single move op with enough blocks overflows the op ID index cap. Today's
	// writer can't author such a change (it re-applies its own ops), but they
	// exist in the wild from older writers, and applying one — e.g. serving
	// GetDocument for such a document — must fail with an error instead of
	// panicking the whole process.
	hugeMove := func(numBlocks int) *blob.Change {
		moved := make([]string, numBlocks)
		for i := range moved {
			moved[i] = fmt.Sprintf("b%d", i)
		}

		return &blob.Change{
			BaseBlob: blob.BaseBlob{
				Type:   blob.TypeChange,
				Signer: alice.Principal(),
				Ts:     time.Now(),
			},
			Body: blob.ChangeBody{
				Ops: []blob.OpMap{blob.NewOpMoveBlocks("", moved, []uint64{0, 0, 0})},
			},
		}
	}

	t.Run("real-world-sized import applies", func(t *testing.T) {
		// The largest single move op seen in the wild carries 6,411 blocks
		// (op index peaks around 20.5M), which overflowed the old 2^24 cap.
		doc := must.Do2(New("mydoc", cclock.New()))
		require.NoError(t, doc.ApplyChange(cid.Undef, hugeMove(6411)))
	})

	t.Run("overflowing the cap fails cleanly", func(t *testing.T) {
		// 70k blocks push the quadratic index past the 2^31-1 cap
		// (at block ~65,537).
		doc := must.Do2(New("mydoc", cclock.New()))
		err := doc.ApplyChange(cid.Undef, hugeMove(70_000))
		require.ErrorContains(t, err, "op ID index")
		require.ErrorContains(t, err, "overflows")
	})
}

func TestIsCollection(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	space := alice.Principal().String()

	// The shape the collection editor maintains: one top-level Query block whose
	// query lists this very document's children.
	queryBlock := func(id string, includes ...map[string]any) *documents.Block {
		list := make([]any, len(includes))
		for i, inc := range includes {
			list[i] = inc
		}
		return &documents.Block{
			Id:   id,
			Type: "Query",
			Attributes: must.Do2(structpb.NewStruct(map[string]any{
				"style": "Table",
				"query": map[string]any{"includes": list},
			})),
		}
	}

	self := func(path string) map[string]any {
		return map[string]any{"space": space, "path": path, "mode": "Children"}
	}

	// Round-trips through a signed change so the predicate runs against a
	// committed document, exactly as the indexer sees it.
	load := func(iri blob.IRI, build func(dm *Document)) *Document {
		doc := must.Do2(New(iri, cclock.New()))
		build(doc)
		c := must.Do2(doc.SignChange(alice))

		out := must.Do2(New(iri, cclock.New()))
		must.Do(out.ApplyChange(c.CID, c.Decoded))
		return out
	}

	notes := blob.IRI("hm://" + space + "/notes")

	t.Run("single childless self-query block is a collection", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self("/notes"))))
		})
		require.True(t, doc.IsCollection())
	})

	t.Run("path without a leading slash still matches", func(t *testing.T) {
		// The query-block editor writes id.path.join('/'), with no leading slash,
		// while hmIdPathToEntityQueryPath writes "/notes". Both are in the wild.
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self("notes"))))
		})
		require.True(t, doc.IsCollection())
	})

	t.Run("AllDescendants counts, since it includes the direct children", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", map[string]any{
				"space": space, "path": "/notes", "mode": "AllDescendants",
			})))
		})
		require.True(t, doc.IsCollection())
	})

	t.Run("one self-targeting include among several is enough", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1",
				map[string]any{"space": space, "path": "/elsewhere", "mode": "Children"},
				self("/notes"),
			)))
		})
		require.True(t, doc.IsCollection())
	})

	t.Run("a root document collecting its own children", func(t *testing.T) {
		home := blob.IRI("hm://" + space)
		doc := load(home, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self(""))))
		})
		require.True(t, doc.IsCollection())
	})

	t.Run("query for another path is not a collection", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self("/other"))))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("query for another space is not a collection", func(t *testing.T) {
		bob := coretest.NewTester("bob").Account
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", map[string]any{
				"space": bob.Principal().String(), "path": "/notes", "mode": "Children",
			})))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("unretargeted draft placeholder is not a collection", func(t *testing.T) {
		// Drafts seed includes as {space: '', path: ''} and publish retargets them.
		// If that never happened, the block does not identify this document.
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", map[string]any{
				"space": "", "path": "", "mode": "Children",
			})))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("a second top-level block disqualifies it", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self("/notes"))))
			must.Do(dm.MoveBlock("p1", "", "q1"))
			must.Do(dm.ReplaceBlock(&documents.Block{Id: "p1", Type: "Paragraph", Text: "and a note"}))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("a child of the query block disqualifies it", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(queryBlock("q1", self("/notes"))))
			must.Do(dm.MoveBlock("q1.1", "q1", ""))
			must.Do(dm.ReplaceBlock(&documents.Block{Id: "q1.1", Type: "Paragraph", Text: "nested"}))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("a single non-Query block is not a collection", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("p1", "", ""))
			must.Do(dm.ReplaceBlock(&documents.Block{Id: "p1", Type: "Paragraph", Text: "just prose"}))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("an empty document is not a collection", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.SetMetadata("title", "Notes"))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("a query block with no query attribute is not a collection", func(t *testing.T) {
		doc := load(notes, func(dm *Document) {
			must.Do(dm.MoveBlock("q1", "", ""))
			must.Do(dm.ReplaceBlock(&documents.Block{Id: "q1", Type: "Query"}))
		})
		require.False(t, doc.IsCollection())
	})

	t.Run("an uncommitted document is never a collection", func(t *testing.T) {
		doc := must.Do2(New(notes, cclock.New()))
		must.Do(doc.MoveBlock("q1", "", ""))
		must.Do(doc.ReplaceBlock(queryBlock("q1", self("/notes"))))
		require.False(t, doc.IsCollection(), "a dirty document has no stable committed state")
	})
}

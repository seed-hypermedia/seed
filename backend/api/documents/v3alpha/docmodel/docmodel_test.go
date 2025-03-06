package docmodel

import (
	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
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
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks.GetMaybe("b1.1").Parent, "deleted block b1.1 must be in trash")
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks.GetMaybe("b3").Parent, "deleted block b3 must be in trash")
		}
	}
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

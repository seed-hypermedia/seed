package docmodel

import (
	"seed/backend/blob"
	"seed/backend/core/coretest"
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
					"key":   "title",
					"type":  "SetKey",
					"value": "Hello",
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

			require.Equal(t, map[string]string{"title": "Hello world"}, doc.crdt.GetMetadata())
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks.GetMaybe("b1.1").Parent, "deleted block b1.1 must be in trash")
			require.Equal(t, TrashNodeID, doc.crdt.tree.State().blocks.GetMaybe("b3").Parent, "deleted block b3 must be in trash")
		}
	}
}

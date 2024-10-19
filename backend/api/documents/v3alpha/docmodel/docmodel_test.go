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
		Ops_: []blob.OpMap{
			{
				"block": "b1",
				"ref":   []any{0, 0, 0},
				"type":  "MoveBlock",
			},
			{
				"block": "b2",
				"ref":   []any{0},
				"type":  "MoveBlock",
			},
			{
				"block": "b3",
				"ref":   []any{1},
				"type":  "MoveBlock",
			},
			{
				"block":  "b1.1",
				"parent": "b1",
				"ref":    []any{0, 0, 0},
				"type":   "MoveBlock",
			},
			{
				"key":   "title",
				"type":  "SetKey",
				"value": "Hello",
			},
		},
	}

	require.Equal(t, want.Ops_, c1.Decoded.Ops_)

	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
		must.Do(doc.SetMetadata("title", "Hello world"))
		c2 := must.Do2(doc.SignChange(alice))

		{
			doc := must.Do2(New("mydoc", cclock.New()))
			must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
			must.Do(doc.ApplyChange(c2.CID, c2.Decoded))

			require.Equal(t, map[string]string{"title": "Hello world"}, doc.crdt.GetMetadata())
		}
	}
}

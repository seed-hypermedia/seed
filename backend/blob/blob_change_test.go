package blob

import (
	"testing"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

func TestBlockEncoding_FieldInlining(t *testing.T) {
	blk := Block{
		Type: "Paragraph",
		Text: "Hello World",
		Attributes: map[string]any{
			"foo": "bar",
		},
		Annotations: []Annotation{
			{
				Type:   "bold",
				Starts: []int32{0},
				Ends:   []int32{5},
				Attributes: map[string]any{
					"hey": "ho",
				},
			},
		},
	}

	wantMap := map[string]any{
		"type": "Paragraph",
		"text": "Hello World",
		"foo":  "bar",
		"annotations": []any{
			map[string]any{
				"type":   "bold",
				"starts": []any{0},
				"ends":   []any{5},
				"hey":    "ho",
			},
		},
	}

	raw, err := cbornode.DumpObject(blk)
	require.NoError(t, err)

	var mapValue map[string]any
	require.NoError(t, cbornode.DecodeInto(raw, &mapValue))

	require.Equal(t, wantMap, mapValue, "the resulting encoding doesn't match")

	var blk2 Block
	require.NoError(t, cbornode.DecodeInto(raw, &blk2), "round-trip decoding failed")
}

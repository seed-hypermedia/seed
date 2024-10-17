package blob

import (
	"testing"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

func TestEncodeOpID(t *testing.T) {
	tests := []struct {
		name string
		op   OpID
	}{
		{
			name: "Zero values",
			op:   OpID{Ts: 0, Idx: 0, Origin: 0},
		},
		{
			name: "Maximum values",
			op:   OpID{Ts: maxTimestamp, Idx: maxIdx, Origin: maxOrigin},
		},
		{
			name: "Random values",
			op:   OpID{Ts: 1234567890, Idx: 9876, Origin: 987654321},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded := tt.op.Encode()
			decoded := encoded.Decode()

			if decoded != tt.op {
				t.Errorf("Round-trip failed. Got %+v, want %+v", decoded, tt.op)
			}
		})
	}
}

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

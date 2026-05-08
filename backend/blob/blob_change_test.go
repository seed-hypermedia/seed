package blob

import (
	"seed/backend/core/coretest"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

func TestBlockEncoding_FieldInlining(t *testing.T) {
	blk := Comment{
		Body: []CommentBlock{
			{Block: Block{
				Type: "Paragraph",
				Text: "Hello World",
				InlineAttributes_: map[string]any{
					"foo": "bar",
				},
				Annotations: []Annotation{
					{
						Type:   "bold",
						Starts: []int32{0},
						Ends:   []int32{5},
						InlineAttributes_: map[string]any{
							"hey": "ho",
						},
					},
				},
			}},
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

	require.Equal(t, wantMap, mapValue["body"].([]any)[0], "the resulting encoding doesn't match")

	var blk2 Block
	require.NoError(t, cbornode.DecodeInto(raw, &blk2), "round-trip decoding failed")
}

// TestChangeMessageRoundTrip verifies that the optional Message field
// survives a CBOR encode/decode cycle and is included in the indexed
// extra_attrs so the API can surface it without re-decoding the blob.
func TestChangeMessageRoundTrip(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	clock := cclock.New()

	msg := "Initial publish: import seed sources"
	c, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Hello")),
		},
	}, clock.MustNow(), msg)
	require.NoError(t, err)

	var decoded Change
	require.NoError(t, cbornode.DecodeInto(c.Data, &decoded))
	require.Equal(t, msg, decoded.Message, "message field must survive CBOR round-trip")

	// Also check that an empty message is omitted from the encoding,
	// preserving backward compatibility for changes without a message.
	c2, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Hello")),
		},
	}, clock.MustNow(), "")
	require.NoError(t, err)

	var raw map[string]any
	require.NoError(t, cbornode.DecodeInto(c2.Data, &raw))
	_, hasMessage := raw["message"]
	require.False(t, hasMessage, "empty message must be omitted from CBOR encoding")
}

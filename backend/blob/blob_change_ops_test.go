package blob

import (
	"fmt"
	"seed/backend/util/must"
	"testing"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

// mapToCBORReference is the implementation ToOp used before it decoded ops
// directly: encode the map back to CBOR, then decode those bytes into the
// variant struct. It only survives as the oracle for TestToOpMatchesCBORRoundTrip,
// which asserts the fast path produces byte-identical results.
//
// The original panicked on error; here we return it so the test can compare
// failure against failure.
func mapToCBORReference(data map[string]any, v any) error {
	rawData, err := cbornode.DumpObject(data)
	if err != nil {
		return err
	}

	return cbornode.DecodeInto(rawData, v)
}

// toOpReference mirrors the original ToOp dispatch, using the CBOR round-trip.
func toOpReference(o OpMap) (Op, error) {
	switch ot := o["type"].(type) {
	case nil:
		return nil, fmt.Errorf("missing op type field")
	case string:
		switch OpType(ot) {
		case OpTypeSetKey:
			var out OpSetKey
			return out, mapToCBORReference(o, &out)
		case OpTypeMoveBlocks:
			var out OpMoveBlocks
			return out, mapToCBORReference(o, &out)
		case OpTypeReplaceBlock:
			var out OpReplaceBlock
			return out, mapToCBORReference(o, &out)
		case OpTypeDeleteBlocks:
			var out OpDeleteBlocks
			return out, mapToCBORReference(o, &out)
		case OpTypeSetAttributes:
			var out OpSetAttributes
			return out, mapToCBORReference(o, &out)
		default:
			return nil, fmt.Errorf("unsupported op type %s", ot)
		}
	default:
		return nil, fmt.Errorf("invalid op type type %T", ot)
	}
}

// opMapCorpus returns ops in the exact shape refmt's wildcard decoder produces:
// integers are plain int, arrays are []any, maps are map[string]any.
func opMapCorpus() map[string]OpMap {
	return map[string]OpMap{
		"SetKey/string":  must.Do2(NewOpSetKey("title", "Initial Document")),
		"SetKey/int":     must.Do2(NewOpSetKey("count", 42)),
		"SetKey/int64":   must.Do2(NewOpSetKey("big", int64(1<<40))),
		"SetKey/bool":    must.Do2(NewOpSetKey("draft", true)),
		"SetKey/nil":     must.Do2(NewOpSetKey("cleared", nil)),
		"SetKey/emptied": {"type": "SetKey", "key": "k", "value": ""},
		// An untyped value passes straight through, so exercise the container
		// shapes the wildcard decoder can hand us.
		"SetKey/map":   {"type": "SetKey", "key": "k", "value": map[string]any{"a": 1, "b": "two"}},
		"SetKey/slice": {"type": "SetKey", "key": "k", "value": []any{1, "two", true}},
		"SetKey/float": {"type": "SetKey", "key": "k", "value": 1.5},
		"SetKey/bytes": {"type": "SetKey", "key": "k", "value": []byte{1, 2, 3}},

		"MoveBlocks/basic":     NewOpMoveBlocks("parent-1", []string{"b1", "b2"}, []uint64{1234, 5678}),
		"MoveBlocks/rootEmpty": NewOpMoveBlocks("", []string{"b1"}, nil),
		"MoveBlocks/emptyRef":  {"type": "MoveBlocks", "parent": "p", "blocks": []any{"b1"}, "ref": []any{}},
		"MoveBlocks/nullRef":   {"type": "MoveBlocks", "parent": "p", "blocks": []any{"b1"}, "ref": nil},
		"MoveBlocks/bigRef":    {"type": "MoveBlocks", "parent": "p", "blocks": []any{"b1"}, "ref": []any{1 << 53}},

		"DeleteBlocks/basic": NewOpDeleteBlocks([]string{"b1", "b2"}),
		"DeleteBlocks/empty": {"type": "DeleteBlocks", "blocks": []any{}},
		"DeleteBlocks/null":  {"type": "DeleteBlocks", "blocks": nil},

		"SetAttributes/doc": NewOpSetAttributes("", []KeyValue{
			{Key: []string{"a", "b"}, Value: "v"},
		}),
		"SetAttributes/block": NewOpSetAttributes("b1", []KeyValue{
			{Key: []string{"level"}, Value: 2},
			{Key: []string{"nested", "deep"}, Value: true},
		}),
		"SetAttributes/nilValue": {"type": "SetAttributes", "block": "b1", "attrs": []any{
			map[string]any{"key": []any{"k"}, "value": nil},
		}},
		"SetAttributes/emptyAttrs": {"type": "SetAttributes", "block": "b1", "attrs": []any{}},
		"SetAttributes/nullAttrs":  {"type": "SetAttributes", "block": "b1", "attrs": nil},

		"ReplaceBlock/simple": NewOpReplaceBlock(Block{
			ID_Good: "b1",
			Type:    "Paragraph",
			Text:    "Hello World",
		}),
		"ReplaceBlock/inlineAttrs": NewOpReplaceBlock(Block{
			ID_Good:           "b1",
			Type:              "Heading",
			Text:              "Title",
			InlineAttributes_: map[string]any{"level": 2, "foo": "bar"},
		}),
		"ReplaceBlock/annotations": NewOpReplaceBlock(Block{
			ID_Good: "b1",
			Type:    "Paragraph",
			Text:    "Hello World",
			Annotations: []Annotation{
				{
					Type:              "bold",
					Starts:            []int32{0},
					Ends:              []int32{5},
					InlineAttributes_: map[string]any{"hey": "ho"},
				},
				{
					Type:   "link",
					Link:   "hm://foo/bar",
					Starts: []int32{6},
					Ends:   []int32{11},
				},
			},
		}),
		"ReplaceBlock/empty": NewOpReplaceBlock(Block{}),

		// The legacy encoding we have to support forever: "iD" instead of "id",
		// and attributes nested under "attributes" instead of inlined.
		"ReplaceBlock/legacyBlock": {"type": "ReplaceBlock", "block": map[string]any{
			"iD":         "old-block",
			"type":       "Paragraph",
			"text":       "Hello",
			"attributes": map[string]any{"level": 2, "childrenType": "Group"},
		}},
		"ReplaceBlock/legacyAnnotation": {"type": "ReplaceBlock", "block": map[string]any{
			"iD":   "old-block",
			"type": "Paragraph",
			"text": "Hello World",
			"annotations": []any{
				map[string]any{
					"type":       "bold",
					"starts":     []any{0},
					"ends":       []any{5},
					"attributes": map[string]any{"weight": "heavy"},
				},
			},
		}},
	}
}

// Note: a null "block" is deliberately absent from the corpus. OpReplaceBlock's
// refmt tag has no omitempty, so the field is always written, and refmt's
// transform machine has no defined behaviour for a null token feeding a
// map-input transform. opBlock still handles nil defensively, but we don't
// assert equivalence on a shape that can't reach us.

// TestToOpMatchesCBORRoundTrip is the safety net for replacing the CBOR
// round-trip: for every op shape we know how to produce, the direct decoding
// must be indistinguishable from what the codec used to return.
func TestToOpMatchesCBORRoundTrip(t *testing.T) {
	for name, om := range opMapCorpus() {
		t.Run(name, func(t *testing.T) {
			want, wantErr := toOpReference(om)
			got, gotErr := om.ToOp()

			if wantErr != nil {
				require.Error(t, gotErr, "reference rejected this op, so must we: %v", wantErr)
				return
			}

			require.NoError(t, gotErr)
			require.Equal(t, want, got)
		})
	}
}

// TestToOpMatchesCBORRoundTripAfterDecode runs the same comparison on ops that
// took the real production route: encoded into a change body and decoded back
// out again, so the maps are exactly what refmt's wildcard decoder yields.
func TestToOpMatchesCBORRoundTripAfterDecode(t *testing.T) {
	corpus := opMapCorpus()

	names := make([]string, 0, len(corpus))
	ops := make([]OpMap, 0, len(corpus))
	for name, om := range corpus {
		names = append(names, name)
		ops = append(ops, om)
	}

	data, err := cbornode.DumpObject(ChangeBody{OpCount: len(ops), Ops: ops})
	require.NoError(t, err)

	var decoded ChangeBody
	require.NoError(t, cbornode.DecodeInto(data, &decoded))
	require.Len(t, decoded.Ops, len(ops))

	for i, om := range decoded.Ops {
		t.Run(names[i], func(t *testing.T) {
			want, wantErr := toOpReference(om)
			got, gotErr := om.ToOp()

			if wantErr != nil {
				require.Error(t, gotErr)
				return
			}

			require.NoError(t, gotErr)
			require.Equal(t, want, got)
		})
	}
}

func TestToOpRejectsBadOps(t *testing.T) {
	t.Parallel()

	for name, om := range map[string]OpMap{
		"missingType":       {"key": "k"},
		"nonStringType":     {"type": 42},
		"unsupportedType":   {"type": "Frobnicate"},
		"unknownField":      {"type": "SetKey", "key": "k", "value": "v", "surprise": 1},
		"unknownKVField":    {"type": "SetAttributes", "attrs": []any{map[string]any{"key": []any{"k"}, "nope": 1}}},
		"wrongStringType":   {"type": "SetKey", "key": 42},
		"wrongSliceType":    {"type": "DeleteBlocks", "blocks": "not-a-slice"},
		"wrongElementType":  {"type": "DeleteBlocks", "blocks": []any{"ok", 42}},
		"negativeRef":       {"type": "MoveBlocks", "blocks": []any{"b1"}, "ref": []any{-1}},
		"blockNotAMap":      {"type": "ReplaceBlock", "block": "not-a-map"},
		"setAttrsBlockType": {"type": "SetAttributes", "block": 42},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := om.ToOp()
			require.Error(t, err)
		})
	}
}

// TestToOpUnknownFieldIsNotAPanic pins the one deliberate behaviour change:
// the old round-trip panicked on an unrecognised field (refmt returns
// ErrNoSuchField and mapToCBOR panicked on it), which took the daemon down for
// a single malformed blob. It is now a returned error, which both callers of
// Ops() already handle.
func TestToOpUnknownFieldIsNotAPanic(t *testing.T) {
	t.Parallel()

	op := OpMap{"type": "SetKey", "key": "k", "value": "v", "fromTheFuture": 1}

	require.NotPanics(t, func() {
		_, err := op.ToOp()
		require.ErrorIs(t, err, errUnknownOpField)
	})
}

func BenchmarkToOp(b *testing.B) {
	cases := map[string]OpMap{
		"SetKey":     {"type": "SetKey", "key": "title", "value": "Some Document Title"},
		"MoveBlocks": {"type": "MoveBlocks", "parent": "p", "blocks": []any{"b1", "b2"}, "ref": []any{1234, 5678}},
		"ReplaceBlock": {"type": "ReplaceBlock", "block": map[string]any{
			"id":    "b1",
			"type":  "Paragraph",
			"text":  "Hello World, this is a reasonably sized paragraph of text.",
			"level": 2,
			"annotations": []any{
				map[string]any{"type": "bold", "starts": []any{0}, "ends": []any{5}},
			},
		}},
	}

	for name, om := range cases {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := om.ToOp(); err != nil {
					b.Fatal(err)
				}
			}
		})

		b.Run(name+"/RoundTripReference", func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := toOpReference(om); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

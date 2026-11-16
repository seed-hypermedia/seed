package docmodel

import (
	"maps"
	"math"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// loadFromBytes builds a document from the encoded form of the changes, the way
// the daemon does when it loads a document from the blob store. Applying the
// in-memory change instead would hide the type differences introduced by the
// CBOR round trip (see attrValuesEqual).
func loadFromBytes(t *testing.T, changes ...blob.Encoded[*blob.Change]) *Document {
	t.Helper()

	doc := must.Do2(New("mydoc", cclock.New()))
	for _, c := range changes {
		decoded := &blob.Change{}
		require.NoError(t, cbornode.DecodeInto(c.Data, decoded))
		require.NoError(t, doc.ApplyChange(c.CID, decoded))
	}

	return doc
}

func richBlock(t *testing.T) *documents.Block {
	t.Helper()

	return &documents.Block{
		Id:   "b1",
		Type: "Query",
		Text: "Hello",
		Attributes: must.Do2(structpb.NewStruct(map[string]any{
			"width":  300,
			"ratio":  1.5,
			"banner": true,
			"empty":  nil,
			"query": map[string]any{
				"limit":    10,
				"includes": []any{map[string]any{"depth": 2, "space": "abc"}},
			},
		})),
		Annotations: []*documents.Annotation{{
			Type:       "Embed",
			Link:       "hm://foo",
			Starts:     []int32{0},
			Ends:       []int32{1},
			Attributes: must.Do2(structpb.NewStruct(map[string]any{"level": 2})),
		}},
	}
}

func TestReplaceBlockDedup_WholeNumberAttributes(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.MoveBlock("b1", "", ""))
	must.Do(doc.ReplaceBlock(richBlock(t)))
	c1 := must.Do2(doc.SignChange(alice))

	doc = loadFromBytes(t, c1)
	must.Do(doc.ReplaceBlock(richBlock(t)))
	c2 := must.Do2(doc.SignChange(alice))
	require.Empty(t, c2.Decoded.Body.Ops, "identical block must not be re-emitted")
	require.Equal(t, 0, c2.Decoded.Body.OpCount)
}

func TestReplaceBlockDedup_DetectsRealChanges(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.MoveBlock("b1", "", ""))
	must.Do(doc.ReplaceBlock(richBlock(t)))
	c1 := must.Do2(doc.SignChange(alice))

	mutations := map[string]func(b *documents.Block){
		"text":              func(b *documents.Block) { b.Text = "Hello!" },
		"type":              func(b *documents.Block) { b.Type = "Paragraph" },
		"link":              func(b *documents.Block) { b.Link = "hm://bar" },
		"whole number":      func(b *documents.Block) { b.Attributes.Fields["width"] = structpb.NewNumberValue(301) },
		"fractional number": func(b *documents.Block) { b.Attributes.Fields["width"] = structpb.NewNumberValue(300.5) },
		"number to string":  func(b *documents.Block) { b.Attributes.Fields["width"] = structpb.NewStringValue("300") },
		"bool":              func(b *documents.Block) { b.Attributes.Fields["banner"] = structpb.NewBoolValue(false) },
		"null to absent":    func(b *documents.Block) { delete(b.Attributes.Fields, "empty") },
		"absent to null":    func(b *documents.Block) { b.Attributes.Fields["extra"] = structpb.NewNullValue() },
		"nested number": func(b *documents.Block) {
			b.Attributes.Fields["query"].GetStructValue().Fields["limit"] = structpb.NewNumberValue(11)
		},
		"nested list": func(b *documents.Block) {
			b.Attributes.Fields["query"].GetStructValue().Fields["includes"] = structpb.NewListValue(&structpb.ListValue{})
		},
		"no attributes":        func(b *documents.Block) { b.Attributes = nil },
		"no annotations":       func(b *documents.Block) { b.Annotations = nil },
		"annotation range":     func(b *documents.Block) { b.Annotations[0].Ends = []int32{2} },
		"annotation attribute": func(b *documents.Block) { b.Annotations[0].Attributes.Fields["level"] = structpb.NewNumberValue(3) },
	}

	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			doc := loadFromBytes(t, c1)
			blk := richBlock(t)
			mutate(blk)
			want := must.Do2(BlockFromProto(blk))

			must.Do(doc.ReplaceBlock(blk))
			c2 := must.Do2(doc.SignChange(alice))
			require.Len(t, c2.Decoded.Body.Ops, 1, "changed block must be emitted")

			// The emitted block must be exactly what the caller sent:
			// normalisation is for comparison only, never for storage.
			require.Equal(t, blob.NewOpReplaceBlock(want), c2.Decoded.Body.Ops[0])
		})
	}
}

// Blocks written by other clients may spell out fields that the daemon's own
// encoding omits. The API can't express the difference, so these must dedup too.
func TestReplaceBlockDedup_ExplicitEmptyFields(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	cases := map[string]map[string]any{
		"empty text":        {"text": ""},
		"empty link":        {"link": ""},
		"empty annotations": {"annotations": []any{}},
		"null annotations":  {"annotations": nil},
		"all":               {"text": "", "link": "", "annotations": []any{}},
	}

	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			doc := must.Do2(New("mydoc", cclock.New()))
			must.Do(doc.MoveBlock("b1", "", ""))
			must.Do(doc.ReplaceBlock(&documents.Block{Id: "b1", Type: "Image"}))
			c1 := must.Do2(doc.SignChange(alice))

			// Rewrite the change the way a client-built one could look like.
			var patched bool

			for _, op := range c1.Decoded.Body.Ops {
				if op["type"] != string(blob.OpTypeReplaceBlock) {
					continue
				}

				maps.Copy(op["block"].(map[string]any), extra)
				patched = true
			}

			require.True(t, patched)
			c1.Data = must.Do2(cbornode.DumpObject(c1.Decoded))

			doc = loadFromBytes(t, c1)
			must.Do(doc.ReplaceBlock(&documents.Block{Id: "b1", Type: "Image"}))
			c2 := must.Do2(doc.SignChange(alice))
			require.Empty(t, c2.Decoded.Body.Ops, "identical block must not be re-emitted")
		})
	}
}

func TestSetAttributeDedup(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	apply := func(doc *Document) {
		must.Do(doc.SetAttribute("", []string{"title"}, "Hello"))
		must.Do(doc.SetAttribute("", []string{"count"}, int64(5)))
		must.Do(doc.SetAttribute("", []string{"flag"}, true))
		must.Do(doc.SetAttribute("", []string{"off"}, false))
		must.Do(doc.SetAttribute("", []string{"gone"}, nil))
		must.Do(doc.SetAttribute("", []string{"theme", "header", "size"}, int64(3)))
		must.Do(doc.SetAttribute("", []string{"theme", "header", "sticky"}, true))
		must.Do(doc.SetAttribute("", []string{"theme", "footer"}, nil))
	}

	doc := must.Do2(New("mydoc", cclock.New()))
	apply(doc)
	c1 := must.Do2(doc.SignChange(alice))
	require.Equal(t, 8, c1.Decoded.Body.OpCount)

	doc = loadFromBytes(t, c1)
	apply(doc)
	c2 := must.Do2(doc.SignChange(alice))
	require.Empty(t, c2.Decoded.Body.Ops, "identical attributes must not be re-emitted")

	doc = loadFromBytes(t, c1)
	apply(doc)
	must.Do(doc.SetAttribute("", []string{"count"}, int64(6)))
	must.Do(doc.SetAttribute("", []string{"flag"}, "true"))
	c3 := must.Do2(doc.SignChange(alice))
	require.Equal(t, 2, c3.Decoded.Body.OpCount, "only the changed attributes must be emitted")
}

// patchBlocks rewrites the blocks of the replace ops inside of a change and
// encodes it again, to produce the bytes that a different writer could have
// produced for the same content.
func patchBlocks(t *testing.T, c blob.Encoded[*blob.Change], patch func(block map[string]any)) blob.Encoded[*blob.Change] {
	t.Helper()

	var patched bool

	for _, op := range c.Decoded.Body.Ops {
		if op["type"] != string(blob.OpTypeReplaceBlock) {
			continue
		}

		patch(op["block"].(map[string]any))
		patched = true
	}

	require.True(t, patched, "change must have a block to patch")
	c.Data = must.Do2(cbornode.DumpObject(c.Decoded))

	return c
}

// toLegacyBlock rewrites a block into the old encoding: the ID is spelled "iD",
// and the attributes are nested inside of an "attributes" map instead of being inlined.
func toLegacyBlock(block map[string]any) {
	attrs := map[string]any{}

	for k, v := range block {
		switch k {
		case "id", "type", "text", "link", "annotations":
		default:
			attrs[k] = v
			delete(block, k)
		}
	}

	block["iD"] = block["id"]
	delete(block, "id")
	block["attributes"] = attrs
}

// commitBlock creates a document with a single block and returns its only change.
func commitBlock(t *testing.T, blk *documents.Block) blob.Encoded[*blob.Change] {
	t.Helper()

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.MoveBlock(blk.Id, "", ""))
	must.Do(doc.ReplaceBlock(blk))

	return must.Do2(doc.SignChange(coretest.NewTester("alice").Account))
}

// requireBlockDedup checks that writing the block on top of the committed state is a no-op.
func requireBlockDedup(t *testing.T, committed blob.Encoded[*blob.Change], blk *documents.Block) {
	t.Helper()

	doc := loadFromBytes(t, committed)
	must.Do(doc.ReplaceBlock(blk))
	c := must.Do2(doc.SignChange(coretest.NewTester("alice").Account))
	require.Empty(t, c.Decoded.Body.Ops, "identical block must not be re-emitted")
	require.Equal(t, 0, c.Decoded.Body.OpCount)
}

// requireBlockEmitted checks that writing the block on top of the committed state
// emits exactly this block, in the current encoding and with the values as the caller sent them.
func requireBlockEmitted(t *testing.T, committed blob.Encoded[*blob.Change], blk *documents.Block) {
	t.Helper()

	want := must.Do2(BlockFromProto(blk))

	doc := loadFromBytes(t, committed)
	must.Do(doc.ReplaceBlock(blk))
	c := must.Do2(doc.SignChange(coretest.NewTester("alice").Account))
	require.Len(t, c.Decoded.Body.Ops, 1, "changed block must be emitted")
	require.Equal(t, blob.NewOpReplaceBlock(want), c.Decoded.Body.Ops[0])
}

// Blocks in the old encoding ("iD" and nested "attributes") have the same
// content as the ones in the current encoding, so they must dedup as well.
func TestReplaceBlockDedup_LegacyEncoding(t *testing.T) {
	legacy := patchBlocks(t, commitBlock(t, richBlock(t)), toLegacyBlock)

	// Make sure we are really testing the old encoding.
	{
		decoded := &blob.Change{}
		require.NoError(t, cbornode.DecodeInto(legacy.Data, decoded))
		op, err := decoded.Body.Ops[len(decoded.Body.Ops)-1].ToOp()
		require.NoError(t, err)
		blk := op.(blob.OpReplaceBlock).Block
		require.Equal(t, "b1", blk.ID_Bad)
		require.Empty(t, blk.ID_Good)
		require.Len(t, blk.Attributes_Old, 5)
		require.Empty(t, blk.InlineAttributes_)
	}

	t.Run("identical", func(t *testing.T) {
		requireBlockDedup(t, legacy, richBlock(t))
	})

	mutations := map[string]func(b *documents.Block){
		"text":           func(b *documents.Block) { b.Text = "Hello!" },
		"attribute":      func(b *documents.Block) { b.Attributes.Fields["width"] = structpb.NewNumberValue(301) },
		"new attribute":  func(b *documents.Block) { b.Attributes.Fields["extra"] = structpb.NewBoolValue(true) },
		"less attribute": func(b *documents.Block) { delete(b.Attributes.Fields, "banner") },
		"no attributes":  func(b *documents.Block) { b.Attributes = nil },
		"nested number": func(b *documents.Block) {
			b.Attributes.Fields["query"].GetStructValue().Fields["limit"] = structpb.NewNumberValue(11)
		},
	}

	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			blk := richBlock(t)
			mutate(blk)
			requireBlockEmitted(t, legacy, blk)
		})
	}
}

// A committed block having both the legacy nested attributes and inline ones
// only exposes the legacy ones. Writing back what was read must still be emitted,
// to replace the block with an unambiguous one.
func TestReplaceBlockDedup_LegacyMixedWithInlineAttributes(t *testing.T) {
	visible := func() *documents.Block {
		return &documents.Block{
			Id:         "b1",
			Type:       "Image",
			Text:       "Hello",
			Attributes: must.Do2(structpb.NewStruct(map[string]any{"width": 300})),
			Annotations: []*documents.Annotation{{
				Type:       "Embed",
				Link:       "hm://foo",
				Starts:     []int32{0},
				Ends:       []int32{1},
				Attributes: must.Do2(structpb.NewStruct(map[string]any{"level": 2})),
			}},
		}
	}

	annotation := func(block map[string]any) map[string]any {
		return block["annotations"].([]any)[0].(map[string]any)
	}

	t.Run("block", func(t *testing.T) {
		mixed := patchBlocks(t, commitBlock(t, visible()), func(block map[string]any) {
			toLegacyBlock(block)
			block["hidden"] = true
		})

		doc := loadFromBytes(t, mixed)
		committed, ok := doc.crdt.stateBlocks["b1"].GetLatestOK()
		require.True(t, ok)
		require.Equal(t, map[string]any{"width": 300}, committed.Attributes_Old)
		require.Equal(t, map[string]any{"hidden": true}, committed.InlineAttributes_)

		requireBlockEmitted(t, mixed, visible())
	})

	t.Run("annotation", func(t *testing.T) {
		mixed := patchBlocks(t, commitBlock(t, visible()), func(block map[string]any) {
			a := annotation(block)
			a["attributes"] = map[string]any{"level": a["level"]}
			a["level"] = 7
		})

		doc := loadFromBytes(t, mixed)
		committed, ok := doc.crdt.stateBlocks["b1"].GetLatestOK()
		require.True(t, ok)
		require.Equal(t, map[string]any{"level": 2}, committed.Annotations[0].Attributes_Old)
		require.Equal(t, map[string]any{"level": 7}, committed.Annotations[0].InlineAttributes_)

		requireBlockEmitted(t, mixed, visible())
	})

	// Only the legacy attributes without the inline ones are not ambiguous.
	t.Run("legacy only", func(t *testing.T) {
		legacy := patchBlocks(t, commitBlock(t, visible()), func(block map[string]any) {
			toLegacyBlock(block)
			a := annotation(block)
			a["attributes"] = map[string]any{"level": a["level"]}
			delete(a, "level")
		})

		requireBlockDedup(t, legacy, visible())
	})
}

// wholeFloatsToInts replaces whole floats with integers at any depth,
// which is how clients encode whole numbers (the daemon itself keeps
// numbers nested inside of attribute values as floats).
func wholeFloatsToInts(v any) any {
	switch vv := v.(type) {
	case float64:
		if n := int64(vv); float64(n) == vv {
			return n
		}
	case map[string]any:
		for k, item := range vv {
			vv[k] = wholeFloatsToInts(item)
		}
	case []any:
		for i, item := range vv {
			vv[i] = wholeFloatsToInts(item)
		}
	}

	return v
}

func TestReplaceBlockDedup_ClientEncodedNestedInts(t *testing.T) {
	var ints int

	client := patchBlocks(t, commitBlock(t, richBlock(t)), func(block map[string]any) {
		query := block["query"].(map[string]any)
		require.IsType(t, float64(0), query["limit"], "daemon is expected to keep nested numbers as floats")
		wholeFloatsToInts(block)
		require.IsType(t, int64(0), query["limit"])
		ints++
	})
	require.Equal(t, 1, ints)

	// The committed side has CBOR integers now, while the incoming one still has floats.
	doc := loadFromBytes(t, client)
	committed, ok := doc.crdt.stateBlocks["b1"].GetLatestOK()
	require.True(t, ok)
	query := committed.Attributes()["query"].(map[string]any)
	require.Equal(t, 10, query["limit"])
	require.Equal(t, 2, query["includes"].([]any)[0].(map[string]any)["depth"])

	incoming := must.Do2(BlockFromProto(richBlock(t)))
	require.Equal(t, float64(10), incoming.Attributes()["query"].(map[string]any)["limit"])

	t.Run("identical", func(t *testing.T) {
		requireBlockDedup(t, client, richBlock(t))
	})

	t.Run("10 to 10.5", func(t *testing.T) {
		blk := richBlock(t)
		blk.Attributes.Fields["query"].GetStructValue().Fields["limit"] = structpb.NewNumberValue(10.5)
		requireBlockEmitted(t, client, blk)
	})

	t.Run("nested in list", func(t *testing.T) {
		blk := richBlock(t)
		include := blk.Attributes.Fields["query"].GetStructValue().Fields["includes"].GetListValue().Values[0]
		include.GetStructValue().Fields["depth"] = structpb.NewNumberValue(2.5)
		requireBlockEmitted(t, client, blk)
	})
}

func TestReplaceBlockDedup_DetectsAnnotationChanges(t *testing.T) {
	block := func() *documents.Block {
		return &documents.Block{
			Id:   "b1",
			Type: "Paragraph",
			Text: "Hello world",
			Annotations: []*documents.Annotation{
				{Type: "Bold", Starts: []int32{0}, Ends: []int32{5}},
				{Type: "Link", Link: "hm://foo", Starts: []int32{6}, Ends: []int32{11}},
			},
		}
	}

	committed := commitBlock(t, block())
	requireBlockDedup(t, committed, block())

	mutations := map[string]func(b *documents.Block){
		"order swap": func(b *documents.Block) {
			b.Annotations[0], b.Annotations[1] = b.Annotations[1], b.Annotations[0]
		},
		"type":        func(b *documents.Block) { b.Annotations[0].Type = "Italic" },
		"link":        func(b *documents.Block) { b.Annotations[1].Link = "hm://bar" },
		"link added":  func(b *documents.Block) { b.Annotations[0].Link = "hm://foo" },
		"link gone":   func(b *documents.Block) { b.Annotations[1].Link = "" },
		"one less":    func(b *documents.Block) { b.Annotations = b.Annotations[:1] },
		"range start": func(b *documents.Block) { b.Annotations[1].Starts = []int32{7} },
	}

	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			blk := block()
			mutate(blk)
			requireBlockEmitted(t, committed, blk)
		})
	}
}

// Values that are "empty" in different ways are different values in the stored data,
// and are exposed as such, so replacing one with another is a change in both directions.
func TestReplaceBlockDedup_DetectsEmptyValueChanges(t *testing.T) {
	pairs := map[string][2]any{
		"empty map vs null":      {map[string]any{}, nil},
		"empty list vs null":     {[]any{}, nil},
		"null in list vs empty":  {[]any{nil}, []any{}},
		"zero vs false":          {0, false},
		"empty string vs null":   {"", nil},
		"empty map vs list":      {map[string]any{}, []any{}},
		"zero vs null":           {0, nil},
		"zero vs empty string":   {0, ""},
		"false vs null":          {false, nil},
		"nested empty map vs no": {map[string]any{"a": map[string]any{}}, map[string]any{"a": nil}},
	}

	block := func(v any) *documents.Block {
		return &documents.Block{
			Id:         "b1",
			Type:       "Image",
			Attributes: &structpb.Struct{Fields: map[string]*structpb.Value{"v": must.Do2(structpb.NewValue(v))}},
		}
	}

	for name, pair := range pairs {
		t.Run(name, func(t *testing.T) {
			for i, from := range pair {
				to := pair[1-i]
				committed := commitBlock(t, block(from))

				requireBlockDedup(t, committed, block(from))
				requireBlockEmitted(t, committed, block(to))
			}
		})
	}
}

func TestAttrValuesEqual_Numbers(t *testing.T) {
	const (
		twoPow53 = 1 << 53
		twoPow63 = float64(1 << 63)
	)

	negZero := math.Copysign(0, -1)

	normalized := []struct {
		name string
		in   any
		want any
	}{
		{"int", int(5), int64(5)},
		{"uint8", uint8(5), int64(5)},
		{"whole float", float64(5), int64(5)},
		{"whole float32", float32(5), int64(5)},
		{"fractional float", 5.5, 5.5},
		{"2^53 float", float64(twoPow53), int64(twoPow53)},
		{"2^53+1 int", int64(twoPow53 + 1), int64(twoPow53 + 1)},
		{"-2^63 float", -twoPow63, int64(math.MinInt64)},
		{"2^63 float", twoPow63, twoPow63},
		{"beyond -2^63 float", -twoPow63 * 2, -twoPow63 * 2},
		{"MaxInt64 uint64", uint64(math.MaxInt64), int64(math.MaxInt64)},
		{"2^63 uint64", uint64(1 << 63), uint64(1 << 63)},
		{"MaxUint64", uint64(math.MaxUint64), uint64(math.MaxUint64)},
		{"MaxUint64 uint", uint(math.MaxUint64), uint64(math.MaxUint64)},
		{"zero float", float64(0), int64(0)},
		{"negative zero", negZero, negZero},
		{"+Inf", math.Inf(1), math.Inf(1)},
	}

	for _, tt := range normalized {
		t.Run("normalize/"+tt.name, func(t *testing.T) {
			got, ok := normalizeNumber(tt.in)
			require.True(t, ok)
			require.IsType(t, tt.want, got)
			require.Equal(t, tt.want, got)

			if f, isFloat := got.(float64); isFloat {
				wantFloat := tt.want.(float64)
				require.Equal(t, math.Signbit(wantFloat), math.Signbit(f), "sign of zero must be preserved")
			}
		})
	}

	t.Run("normalize/NaN", func(t *testing.T) {
		got, ok := normalizeNumber(math.NaN())
		require.True(t, ok)
		require.IsType(t, float64(0), got)
		require.True(t, math.IsNaN(got.(float64)))
	})

	t.Run("normalize/not a number", func(t *testing.T) {
		for _, v := range []any{nil, "5", true, []any{1}, map[string]any{"a": 1}} {
			_, ok := normalizeNumber(v)
			require.False(t, ok, "%T", v)
		}
	})

	equality := []struct {
		name string
		a, b any
		want bool
	}{
		{"int vs int64", int(5), int64(5), true},
		{"int vs whole float", int(5), float64(5), true},
		{"int vs fractional float", int(5), 5.5, false},
		{"uint64 vs int", uint64(5), int(5), true},

		// 2^53+1 has no float64 representation: the nearest float is 2^53.
		{"2^53+1 vs itself", int(twoPow53 + 1), int64(twoPow53 + 1), true},
		{"2^53+1 vs nearest float", int64(twoPow53 + 1), float64(twoPow53 + 1), false},
		{"2^53 vs float", int64(twoPow53), float64(twoPow53), true},
		{"2^53+1 vs 2^53", int64(twoPow53 + 1), int64(twoPow53), false},

		{"-2^63 float vs MinInt64", -twoPow63, int64(math.MinInt64), true},
		{"2^63 float vs itself", twoPow63, twoPow63, true},
		// The float is 1 more than the integer, even though converting one into another says otherwise.
		{"2^63 float vs MaxInt64", twoPow63, int64(math.MaxInt64), false},
		{"2^63 float vs MinInt64", twoPow63, int64(math.MinInt64), false},
		{"2^63 float vs -2^63 float", twoPow63, -twoPow63, false},
		// Same number in different kinds beyond int64. Reported as different,
		// which errs on the side of emitting a change.
		{"2^63 float vs 2^63 uint64", twoPow63, uint64(1 << 63), false},

		{"MaxUint64 vs itself", uint64(math.MaxUint64), uint(math.MaxUint64), true},
		{"MaxUint64 vs -1", uint64(math.MaxUint64), int64(-1), false},
		{"MaxInt64+1 uint64 vs MinInt64", uint64(1 << 63), int64(math.MinInt64), false},
		{"MaxInt64 uint64 vs int64", uint64(math.MaxInt64), int64(math.MaxInt64), true},

		{"negative zero vs int zero", negZero, int64(0), false},
		{"negative zero vs zero", negZero, float64(0), false},
		{"negative zero vs itself", negZero, math.Copysign(0, -1), true},
		{"zero float vs int zero", float64(0), int(0), true},

		{"NaN vs NaN", math.NaN(), math.NaN(), false},
		{"NaN vs zero", math.NaN(), int64(0), false},
		{"Inf vs Inf", math.Inf(1), math.Inf(1), true},
		{"Inf vs -Inf", math.Inf(1), math.Inf(-1), false},

		{"zero vs false", int64(0), false, false},
		{"zero vs nil", int64(0), nil, false},
		{"zero vs empty string", int64(0), "", false},
		{"number vs string", int64(5), "5", false},

		{"nested", map[string]any{"a": []any{int(1), float64(2)}}, map[string]any{"a": []any{int64(1), int64(2)}}, true},
		{"nested negative zero", []any{negZero}, []any{int(0)}, false},
		{"nested NaN", map[string]any{"a": math.NaN()}, map[string]any{"a": math.NaN()}, false},
	}

	for _, tt := range equality {
		t.Run("equal/"+tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, attrValuesEqual(tt.a, tt.b))
			require.Equal(t, tt.want, attrValuesEqual(tt.b, tt.a), "must be symmetric")
		})
	}
}

func TestSetAttributeDedup_DetectsRealChanges(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.SetAttribute("", []string{"count"}, int64(5)))
	must.Do(doc.SetAttribute("", []string{"zero"}, int64(0)))
	must.Do(doc.SetAttribute("", []string{"gone"}, nil))
	must.Do(doc.SetAttribute("", []string{"theme", "size"}, int64(3)))
	c1 := must.Do2(doc.SignChange(alice))
	require.Equal(t, 4, c1.Decoded.Body.OpCount)

	cases := []struct {
		name  string
		key   []string
		value any
	}{
		{"int to null", []string{"count"}, nil},
		{"int to zero", []string{"count"}, int64(0)},
		{"int to string", []string{"count"}, "5"},
		{"nested int to null", []string{"theme", "size"}, nil},
		{"nested int to zero", []string{"theme", "size"}, int64(0)},
		{"zero to null", []string{"zero"}, nil},
		{"zero to false", []string{"zero"}, false},
		{"zero to empty string", []string{"zero"}, ""},
		{"null to zero", []string{"gone"}, int64(0)},
		{"null to false", []string{"gone"}, false},
		{"null to empty string", []string{"gone"}, ""},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			doc := loadFromBytes(t, c1)
			must.Do(doc.SetAttribute("", tt.key, tt.value))
			c2 := must.Do2(doc.SignChange(alice))
			require.Equal(t, 1, c2.Decoded.Body.OpCount, "changed attribute must be emitted")

			// The new value must be the one that reads back.
			doc = loadFromBytes(t, c1, c2)
			reg := doc.crdt.stateMetadata.GetMaybe(tt.key)
			require.NotNil(t, reg)
			require.True(t, attrValuesEqual(tt.value, reg.GetLatest().Value), "got %#v", reg.GetLatest().Value)

			// And writing it again is a no-op.
			must.Do(doc.SetAttribute("", tt.key, tt.value))
			c3 := must.Do2(doc.SignChange(alice))
			require.Empty(t, c3.Decoded.Body.Ops)
		})
	}
}

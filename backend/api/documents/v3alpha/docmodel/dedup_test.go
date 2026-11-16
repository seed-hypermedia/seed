package docmodel

import (
	"maps"
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

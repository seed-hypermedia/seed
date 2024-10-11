package blob

import (
	"bytes"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

func init() {
	cbornode.RegisterCborType(Change{})
	cbornode.RegisterCborType(ChangeUnsigned{})
	cbornode.RegisterCborType(Op{})
}

const blobTypeChange blobType = "Change"

// OpType is a type for operation types.
type OpType string

// Op is an atom of our op-based CRDT structure.
type Op struct {
	Op   OpType         `refmt:"op"`
	Data map[string]any `refmt:"data,omitempty"`
}

// Supported op types.
const (
	OpSetMetadata  OpType = "SetMetadata"  // Args = key => value.
	OpMoveBlock    OpType = "MoveBlock"    // Args = block, parent, left+origin.
	OpReplaceBlock OpType = "ReplaceBlock" // Args = id => block data.
)

// NewOpSetMetadata creates a SetMetadata op.
func NewOpSetMetadata(key string, value any) Op {
	return Op{
		Op:   OpSetMetadata,
		Data: map[string]any{key: value}, // TODO(burdiyan): or key => key, value => value?
	}
}

// NewOpMoveBlock creates a MoveBlock op.
func NewOpMoveBlock(block, parent, leftOrigin string) Op {
	return Op{
		Op: OpMoveBlock,
		Data: map[string]any{
			"block":      block,
			"parent":     parent,
			"leftOrigin": leftOrigin,
		},
	}
}

// NewOpReplaceBlock creates a ReplaceBlock op.
func NewOpReplaceBlock(state Block) Op {
	return Op{
		Op:   OpReplaceBlock,
		Data: CBORToMap(state),
	}
}

// Change is an atomic change to a document.
// The linked DAG of Changes represents the state of a document over time.
type Change struct {
	ChangeUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

// NewChange creates a new Change.
func NewChange(kp core.KeyPair, genesis cid.Cid, deps []cid.Cid, depth int, ops []Op, ts time.Time) (eb Encoded[*Change], err error) {
	cu := ChangeUnsigned{
		Type:    blobTypeChange,
		Genesis: genesis,
		Deps:    deps,
		Depth:   depth,
		Ops:     ops,
		Author:  kp.Principal(),
		Ts:      ts,
	}

	cc, err := cu.Sign(kp)
	if err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

// ChangeUnsigned holds the fields of a Change that are supposed to be signed.
type ChangeUnsigned struct {
	Type    blobType       `refmt:"@type"`
	Genesis cid.Cid        `refmt:"genesis,omitempty"`
	Deps    []cid.Cid      `refmt:"deps,omitempty"`
	Depth   int            `refmt:"depth,omitempty"`
	Ops     []Op           `refmt:"ops,omitempty"`
	Author  core.Principal `refmt:"author"`
	Ts      time.Time      `refmt:"ts"`
}

// Sign the change with the provided key pair.
func (c *ChangeUnsigned) Sign(kp core.KeyPair) (cc *Change, err error) {
	if !c.Author.Equal(kp.Principal()) {
		return nil, fmt.Errorf("author mismatch when signing")
	}

	data, err := cbornode.DumpObject(c)
	if err != nil {
		return nil, err
	}

	sig, err := kp.Sign(data)
	if err != nil {
		return nil, err
	}

	return &Change{
		ChangeUnsigned: *c,
		Sig:            sig,
	}, nil
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeChange)
	registerIndexer(blobTypeChange,
		func(c cid.Cid, data []byte) (*Change, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Change{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexChange,
	)
}

func indexChange(ictx *indexingCtx, id int64, c cid.Cid, v *Change) error {
	// TODO(burdiyan): ensure there's only one change that brings an entity into life.

	author := v.Author

	switch {
	case v.Genesis.Defined() && len(v.Deps) > 0 && v.Depth > 0:
		// Non-genesis change.
	case !v.Genesis.Defined() && len(v.Deps) == 0 && v.Depth == 0:
		// Genesis change.
	default:
		// Everything else is invalid.
		return fmt.Errorf("invalid change causality invariants: cid=%s genesis=%s deps=%v depth=%v", c, v.Genesis, v.Deps, v.Depth)
	}

	var sb StructuralBlob
	{
		var resourceTime time.Time
		// Change with no deps is the genesis change.
		if len(v.Deps) == 0 {
			resourceTime = v.Ts
		}
		sb = newStructuralBlob(c, string(blobTypeChange), author, v.Ts, "", v.Genesis, author, resourceTime)
	}

	// TODO(burdiyan): ensure deps are indexed, not just known.
	// Although in practice deps must always be indexed first, but need to make sure.
	for _, dep := range v.Deps {
		if err := ictx.AssertBlobData(dep); err != nil {
			return fmt.Errorf("missing causal dependency %s of change %s", dep, c)
		}

		sb.AddBlobLink("change/dep", dep)
	}

	var meta struct {
		Title string `json:"title"`
	}
	for _, op := range v.Ops {
		switch op.Op {
		case OpSetMetadata:
			for k, v := range op.Data {
				vs, ok := v.(string)
				if !ok {
					continue
				}

				if meta.Title == "" && (k == "title" || k == "name" || k == "alias") {
					meta.Title = vs
				}

				u, err := url.Parse(vs)
				if err != nil {
					continue
				}

				if u.Scheme != "ipfs" {
					continue
				}

				c, err := cid.Decode(u.Host)
				if err != nil {
					continue
				}

				sb.AddBlobLink("metadata/"+k, c)
				// TODO(hm24): index other relevant metadata for list response and so on.
			}
		case OpReplaceBlock:
			rawBlock, err := cbornode.DumpObject(op.Data)
			if err != nil {
				return fmt.Errorf("bad data?: failed to encode block into cbor when indexing: %w", err)
			}

			var blk Block
			if err := cbornode.DecodeInto(rawBlock, &blk); err != nil {
				return fmt.Errorf("bad data?: failed to decode cbor block: %w", err)
			}

			if err := indexURL(&sb, ictx.log, blk.ID, "doc/"+blk.Type, blk.Link); err != nil {
				return err
			}

			for _, ann := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.ID, "doc/"+ann.Type, ann.Link); err != nil {
					return err
				}
			}
		}
	}

	if meta.Title != "" {
		sb.Meta = meta
	}

	return ictx.SaveBlob(id, sb)
}

// Block is a block of text with annotations.
type Block struct {
	ID          string            `refmt:"id,omitempty"` // Omitempty when used in Documents.
	Type        string            `refmt:"type,omitempty"`
	Text        string            `refmt:"text,omitempty"`
	Link        string            `refmt:"link,omitempty"`
	Attributes  map[string]string `refmt:"attributes,omitempty"`
	Annotations []Annotation      `refmt:"annotations,omitempty"`
}

// Annotation is a range of text that has a type and attributes.
type Annotation struct {
	Type       string            `refmt:"type"`
	Link       string            `refmt:"link,omitempty"`
	Attributes map[string]string `refmt:"attributes,omitempty"`
	Starts     []int32           `refmt:"starts,omitempty"`
	Ends       []int32           `refmt:"ends,omitempty"`
}

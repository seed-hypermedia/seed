package blob

import (
	"bytes"
	"cmp"
	"fmt"
	"iter"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"slices"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"github.com/polydawn/refmt/obj/atlas"
)

const blobTypeChange blobType = "Change"

// Change is an atomic change to a document.
// The linked DAG of Changes represents the state of a document over time.
type Change struct {
	baseBlob
	Genesis cid.Cid    `refmt:"genesis,omitempty"`
	Deps    []cid.Cid  `refmt:"deps,omitempty"`
	Depth   int        `refmt:"depth,omitempty"`
	Body    ChangeBody `refmt:"body,omitempty"`
}

// ChangeBody is the body of a Change.
type ChangeBody struct {
	// OpCount is the number of "logical" operations in the change.
	// Some op items in the list may be run-length encoded,
	// such that one physical item represents multiple logical ops.
	// This field is provided as a hint to the consumer of the change.
	OpCount int `refmt:"opCount,omitempty"`

	// Ops is a list of operations that make up the change.
	// Some ops may be run-length encoded.
	Ops []OpMap `refmt:"ops,omitempty"`
}

// NewChange creates a new Change.
func NewChange(kp core.KeyPair, genesis cid.Cid, deps []cid.Cid, depth int, body ChangeBody, ts time.Time) (eb Encoded[*Change], err error) {
	if !slices.IsSortedFunc(deps, func(a, b cid.Cid) int {
		return cmp.Compare(a.KeyString(), b.KeyString())
	}) {
		panic("BUG: deps are not sorted")
	}

	cc := &Change{
		baseBlob: baseBlob{
			Type:   blobTypeChange,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Genesis: genesis,
		Deps:    deps,
		Depth:   depth,
		Body:    body,
	}

	if err := signBlob(kp, cc, &cc.baseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

// Ops is an iterator over the ops in the change.
// We don't expose the underlying slice of Ops,
// because eventually some data will be run-length encoded in there.
func (c *Change) Ops() iter.Seq2[Op, error] {
	return func(yield func(Op, error) bool) {
		for _, v := range c.Body.Ops {
			if !yield(v.ToOp()) {
				break
			}
		}
	}
}

func init() {
	cbornode.RegisterCborType(Change{})
	cbornode.RegisterCborType(ChangeBody{})
	cbornode.RegisterCborType(OpSetKey{})
	cbornode.RegisterCborType(OpReplaceBlock{})
	cbornode.RegisterCborType(OpMoveBlocks{})
	cbornode.RegisterCborType(OpDeleteBlocks{})

	// We decided to encode our union types with type-specific fields inlined.
	// It's really painful in Go, so we need to do this crazy hackery
	// to make it work for Blocks and Annotations,
	// because we don't even know all the possible fields in advance on the backend.
	// I (burdiyan) hope we won't regret this decision.

	cbornode.RegisterCborType(atlas.BuildEntry(Block{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in Block) (map[string]any, error) {
			var v map[string]any
			if err := mapstructure.Decode(in, &v); err != nil {
				return nil, err
			}

			return v, nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (Block, error) {
			var v Block
			if err := mapstructure.Decode(in, &v); err != nil {
				return v, err
			}
			return v, nil
		})).
		Complete(),
	)

	cbornode.RegisterCborType(atlas.BuildEntry(Annotation{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in Annotation) (map[string]any, error) {
			var v map[string]any
			if err := mapstructure.Decode(in, &v); err != nil {
				return nil, err
			}
			return v, nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (Annotation, error) {
			var v Annotation
			if err := mapstructure.Decode(in, &v); err != nil {
				return v, err
			}
			return v, nil
		})).
		Complete(),
	)
}

// OpType is a type for operation types.
type OpType string

// OpMap is a map representation of op data.
// TODO(burdiyan): find something reasonable to work with union types.
type OpMap map[string]any

// ToOp converts the map into a concrete op type, checking the discriminator field.
func (o OpMap) ToOp() (Op, error) {
	switch ot := o["type"].(type) {
	case nil:
		return nil, fmt.Errorf("missing op type field")
	case string:
		switch OpType(ot) {
		case OpTypeSetKey:
			var out OpSetKey
			mapToCBOR(o, &out)
			return out, nil
		case OpTypeMoveBlocks:
			var out OpMoveBlocks
			mapToCBOR(o, &out)
			return out, nil
		case OpTypeReplaceBlock:
			var out OpReplaceBlock
			mapToCBOR(o, &out)
			return out, nil
		case OpTypeDeleteBlocks:
			var out OpDeleteBlocks
			mapToCBOR(o, &out)
			return out, nil
		default:
			return nil, fmt.Errorf("unsupported op type %s", o)
		}
	default:
		return nil, fmt.Errorf("invalid op type type %T", o)
	}
}

// Supported op types.
const (
	OpTypeSetKey       OpType = "SetKey"
	OpTypeMoveBlock    OpType = "MoveBlock"
	OpTypeMoveBlocks   OpType = "MoveBlocks"
	OpTypeReplaceBlock OpType = "ReplaceBlock"
	OpTypeDeleteBlocks OpType = "DeleteBlocks"
)

// Op a common interface implemented by all ops.
type Op interface {
	isOp()
}

// baseOp is the common attributes for all ops.
type baseOp struct {
	Type OpType `refmt:"type"`
}

func (o baseOp) isOp() {}

// OpSetKey represents the op to set a key in the document attributes.
type OpSetKey struct {
	baseOp
	Key   string `refmt:"key"`
	Value any    `refmt:"value"`
}

// NewOpSetKey creates the corresponding op.
func NewOpSetKey(key string, value any) OpMap {
	switch value.(type) {
	case string, int, bool:
	// OK.
	default:
		panic(fmt.Sprintf("unsupported metadata value type: %T", value))
	}

	op := OpSetKey{
		baseOp: baseOp{
			Type: OpTypeSetKey,
		},
		Key:   key,
		Value: value,
	}

	return cborToMap(op)
}

// OpMoveBlocks represents the op to move a contiguous sequence of blocks under a parent block in a ref position.
type OpMoveBlocks struct {
	baseOp
	Parent string   `refmt:"parent,omitempty"` // Empty parent means root block.
	Blocks []string `refmt:"blocks"`           // Contiguous sequence of blocks to position under parent after ref position.
	Ref    []uint64 `refmt:"ref,omitempty"`    // RGA CRDT Ref ID. Empty means start of the list.
}

// NewOpMoveBlocks creates the corresponding op.
func NewOpMoveBlocks(parent string, blocks []string, ref []uint64) OpMap {
	op := OpMoveBlocks{
		baseOp: baseOp{
			Type: OpTypeMoveBlocks,
		},
		Parent: parent,
		Blocks: blocks,
		Ref:    ref,
	}

	return cborToMap(op)
}

// OpReplaceBlock represents the op to replace the state of a given block.
type OpReplaceBlock struct {
	baseOp
	Block Block `refmt:"block"`
}

// NewOpReplaceBlock creates the corresponding op.
func NewOpReplaceBlock(state Block) OpMap {
	op := OpReplaceBlock{
		baseOp: baseOp{
			Type: OpTypeReplaceBlock,
		},
		Block: state,
	}

	return cborToMap(op)
}

// OpDeleteBlocks represents the op to delete a set of blocks.
type OpDeleteBlocks struct {
	baseOp
	Blocks []string `refmt:"blocks"`
}

// NewOpDeleteBlocks creates the corresponding op.
func NewOpDeleteBlocks(blocks []string) OpMap {
	op := OpDeleteBlocks{
		baseOp: baseOp{
			Type: OpTypeDeleteBlocks,
		},
		Blocks: blocks,
	}

	return cborToMap(op)
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

			if err := verifyBlob(v.Signer, v, &v.Sig); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexChange,
	)
}

func indexChange(ictx *indexingCtx, id int64, c cid.Cid, v *Change) error {
	// TODO(burdiyan): ensure there's only one change that brings an entity into life.

	author := v.Signer

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

	if v.Genesis.Defined() {
		sb.GenesisBlob = v.Genesis
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
	for op, err := range v.Ops() {
		if err != nil {
			return err
		}
		switch op := op.(type) {
		case OpSetKey:
			k, v := op.Key, op.Value

			vs, ok := v.(string)
			if !ok {
				continue
			}

			// TODO(hm24): index other relevant metadata for list response and so on.
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
		case OpReplaceBlock:
			blk := op.Block

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
	ID          string         `mapstructure:"id,omitempty"` // Omitempty when used in Documents.
	Type        string         `mapstructure:"type,omitempty"`
	Text        string         `mapstructure:"text,omitempty"`
	Link        string         `mapstructure:"link,omitempty"`
	Attributes  map[string]any `mapstructure:",remain"`
	Annotations []Annotation   `mapstructure:"annotations,omitempty"`
}

// Annotation is a range of text that has a type and attributes.
type Annotation struct {
	Type       string         `mapstructure:"type"`
	Link       string         `mapstructure:"link,omitempty"`
	Attributes map[string]any `mapstructure:",remain"`
	Starts     []int32        `mapstructure:"starts,omitempty"`
	Ends       []int32        `mapstructure:"ends,omitempty"`
}

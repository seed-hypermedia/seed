package blob

import (
	"bytes"
	"cmp"
	"fmt"
	"iter"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strings"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"github.com/polydawn/refmt/obj/atlas"
)

// TypeChange is the type for Change blobs.
const TypeChange Type = "Change"

// Change is an atomic change to a document.
// The linked DAG of Changes represents the state of a document over time.
type Change struct {
	BaseBlob
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
func NewChange(kp *core.KeyPair, genesis cid.Cid, deps []cid.Cid, depth int, body ChangeBody, ts time.Time) (eb Encoded[*Change], err error) {
	if !slices.IsSortedFunc(deps, func(a, b cid.Cid) int {
		return cmp.Compare(a.KeyString(), b.KeyString())
	}) {
		panic("BUG: deps are not sorted")
	}

	cc := &Change{
		BaseBlob: BaseBlob{
			Type:   TypeChange,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Genesis: genesis,
		Deps:    deps,
		Depth:   depth,
		Body:    body,
	}

	if err := signBlob(kp, cc, &cc.BaseBlob.Sig); err != nil {
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
	cbornode.RegisterCborType(OpSetAttributes{})
	cbornode.RegisterCborType(KeyValue{})

	// We decided to encode our union types with type-specific fields inlined.
	// It's really painful in Go, so we need to do this crazy hackery
	// to make it work for Blocks and Annotations,
	// because we don't even know all the possible fields in advance on the backend.
	// I (burdiyan) hope we won't regret this decision.

	cbornode.RegisterCborType(atlas.BuildEntry(Block{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in Block) (map[string]any, error) {
			var v map[string]any
			if err := mapstruct(in, &v); err != nil {
				return nil, err
			}

			return v, nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (Block, error) {
			var v Block
			if err := mapstruct(in, &v); err != nil {
				return v, err
			}
			return v, nil
		})).
		Complete(),
	)

	cbornode.RegisterCborType(atlas.BuildEntry(Annotation{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in Annotation) (map[string]any, error) {
			var v map[string]any
			if err := mapstruct(in, &v); err != nil {
				return nil, err
			}
			return v, nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (Annotation, error) {
			var v Annotation
			if err := mapstruct(in, &v); err != nil {
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
		case OpTypeSetAttributes:
			var out OpSetAttributes
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
	OpTypeSetKey        OpType = "SetKey" // Deprecated.
	OpTypeSetAttributes OpType = "SetAttributes"
	OpTypeMoveBlocks    OpType = "MoveBlocks"
	OpTypeReplaceBlock  OpType = "ReplaceBlock"
	OpTypeDeleteBlocks  OpType = "DeleteBlocks"
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

const maxJSInt = 1<<53 - 1

// NewOpSetKey creates the corresponding op.
func NewOpSetKey(key string, value any) (OpMap, error) {
	var number int64

	switch vv := value.(type) {
	case string, bool, nil:
	// OK.
	case int:
		number = int64(vv)
	case int64:
		number = vv
	default:
		panic(fmt.Sprintf("unsupported metadata value type: %T", value))
	}

	if number > maxJSInt {
		return OpMap{}, fmt.Errorf("numeric value %v is greater than JS max safe int %v", value, maxJSInt)
	}

	op := OpSetKey{
		baseOp: baseOp{
			Type: OpTypeSetKey,
		},
		Key:   key,
		Value: value,
	}

	return cborToMap(op), nil
}

// OpSetAttributes represents the op to set a set of attributes to a given block or the document itself.
type OpSetAttributes struct {
	baseOp
	Block string     `refmt:"block,omitempty"`
	Attrs []KeyValue `refmt:"attrs,omitempty"`
}

// KeyValue is a pair representing the nested attribute.
type KeyValue struct {
	Key   []string `refmt:"key,omitempty"`
	Value any      `refmt:"value"`
}

// NewOpSetAttributes creates a new op that sets some attributes on a block.
func NewOpSetAttributes(block string, attrs []KeyValue) OpMap {
	op := OpSetAttributes{
		baseOp: baseOp{
			Type: OpTypeSetAttributes,
		},
		Block: block,
		Attrs: attrs,
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
	matcher := makeCBORTypeMatch(TypeChange)
	registerIndexer(TypeChange,
		func(c cid.Cid, data []byte) (eb Encoded[*Change], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return eb, errSkipIndexing
			}

			v := &Change{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return eb, err
			}

			if err := verifyBlob(v.Signer, v, v.Sig); err != nil {
				return eb, err
			}

			eb.CID = c
			eb.Data = data
			eb.Decoded = v
			return eb, nil
		},
		indexChange,
	)
}

func indexChange(ictx *indexingCtx, id int64, eb Encoded[*Change]) error {
	c, v := eb.CID, eb.Decoded

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
	var sb structuralBlob
	{
		var resourceTime time.Time
		// Change with no deps is the genesis change.
		if len(v.Deps) == 0 {
			resourceTime = v.Ts
		}
		sb = newStructuralBlob(c, TypeChange, author, v.Ts, "", v.Genesis, author, resourceTime)
	}

	if v.Genesis.Defined() {
		sb.GenesisBlob = v.Genesis
	}

	// TODO(burdiyan): ensure deps are indexed, not just known.
	// Although in practice deps must always be indexed first, but need to make sure.
	for _, dep := range v.Deps {
		bp, err := ictx.GetBlobPresence(dep)
		if err != nil {
			return err
		}

		if bp != BlobPresenceHasData {
			return fmt.Errorf("missing causal dependency %s of change %s", dep, c)
		}

		sb.AddBlobLink("change/dep", dep)
	}

	var extra changeIndexedAttrs
	for op, err := range v.Ops() {
		if err != nil {
			return err
		}
		switch op := op.(type) {
		case OpSetKey:
			k, v := op.Key, op.Value

			if extra.Metadata == nil {
				extra.Metadata = make(map[string]any)
			}

			extra.Metadata[k] = v

			vs, ok := v.(string)
			if !ok {
				continue
			}

			// TODO(hm24): index other relevant metadata for list response and so on.
			if extra.Title == "" && (k == "title" || k == "name" || k == "alias") {
				extra.Title = vs
				if err := dbFTSInsertOrReplace(ictx.conn, vs, "title", id, "", sb.CID.String()); err != nil {
					return fmt.Errorf("failed to insert record in fts table: %w", err)
				}
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
		case OpSetAttributes:
			if op.Block != "" {
				continue
			}

			if extra.Metadata == nil {
				extra.Metadata = make(map[string]any)
			}

			for _, kv := range op.Attrs {
				k := strings.Join(kv.Key, ".")
				extra.Metadata[k] = kv.Value

				vs, isStr := kv.Value.(string)
				if len(kv.Key) == 1 && isStr {
					k := kv.Key[0]

					// TODO(hm24): index other relevant metadata for list response and so on.
					if extra.Title == "" && (k == "title" || k == "name" || k == "alias") {
						extra.Title = vs
						if err := dbFTSInsertOrReplace(ictx.conn, vs, "title", id, "", sb.CID.String()); err != nil {
							return fmt.Errorf("failed to insert record in fts table: %w", err)
						}
					}
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
			}
		case OpReplaceBlock:
			blk := op.Block
			if err := indexURL(&sb, ictx.log, blk.ID(), "doc/"+blk.Type, blk.Link); err != nil {
				return err
			}

			for _, ann := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.ID(), "doc/"+ann.Type, ann.Link); err != nil {
					return err
				}
			}
			if err := dbFTSInsertOrReplace(ictx.conn, blk.Text, "document", id, blk.ID(), sb.CID.String()); err != nil {
				return fmt.Errorf("failed to insert record in fts table: %w", err)
			}
		}
	}

	if extra.Title != "" || len(extra.Metadata) > 0 {
		sb.ExtraAttrs = extra
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	{
		refs, err := loadRefsForChange(ictx.conn, ictx.blockStore, id)
		if err != nil {
			return err
		}

		for _, ref := range refs {
			if err := crossLinkRefMaybe(
				// TODO(burdiyan): doing some ugly stuff here. We need a new indexing context,
				// because now we are trying to index a Ref blob that might be related to the change we are currently indexing.
				// Currently the indexing context is tied to a single blob, but it shouldn't be this way.
				// There's more code like this. Search for (#ictxDRY).
				newCtx(ictx.conn, ref.ID, ictx.blockStore, ictx.log),
				ref.Value,
			); err != nil {
				return err
			}
		}
	}

	return nil
}

type changeIndexedAttrs struct {
	Title    string         `json:"title"` // Deprecated. TODO(burdiyan): remove this in favor of metadata.
	Metadata map[string]any `json:"metadata,omitempty"`
}

type decodedBlob[T any] struct {
	ID    int64
	CID   cid.Cid
	Value T
}

func loadRefsForChange(conn *sqlite.Conn, bs *blockStore, changeID int64) ([]decodedBlob[*Ref], error) {
	var out []decodedBlob[*Ref]
	rows, check := sqlitex.Query(conn, qLoadRefsForChange(), changeID)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			id        = row.ColumnInt64(inc())
			codec     = row.ColumnInt64(inc())
			multihash = row.ColumnBytes(inc())
			rawData   = row.ColumnBytesUnsafe(inc())
			size      = row.ColumnInt64(inc())
		)

		data, err := bs.decompress(rawData, int(size))
		if err != nil {
			return nil, err
		}

		ref := &Ref{}
		if err := cbornode.DecodeInto(data, &ref); err != nil {
			return nil, err
		}
		out = append(out, decodedBlob[*Ref]{
			ID:    id,
			CID:   cid.NewCidV1(uint64(codec), multihash),
			Value: ref,
		})
	}

	err := check()
	if err != nil {
		return nil, err
	}

	return out, nil
}

var qLoadRefsForChange = dqb.Str(`
	SELECT
		blobs.id,
		blobs.codec,
		blobs.multihash,
		blobs.data,
		blobs.size
	FROM blob_links bl
	JOIN blobs ON blobs.id = bl.source
	WHERE bl.target = :changeID
	AND bl.type = 'ref/head'
	AND blobs.size > 0;
`)

// Block is a block of text with annotations.
type Block struct {
	ID_Good string `mapstructure:"id,omitempty"` // Omitempty when used in Documents.

	// We messed up the encoding of blocks in some comment early on,
	// so we have to be able to support the format forever.
	// In the old encoding the ID field was encoded as "iD",
	// and attributes that should be inlined with the top-level map
	// were encoded as a map inside of an "attributes" field.
	ID_Bad         string         `mapstructure:"iD,omitempty"`
	Attributes_Old map[string]any `mapstructure:"attributes,omitempty"`

	Type              string         `mapstructure:"type,omitempty"`
	Text              string         `mapstructure:"text,omitempty"`
	Link              string         `mapstructure:"link,omitempty"`
	InlineAttributes_ map[string]any `mapstructure:",remain"`
	Annotations       []Annotation   `mapstructure:"annotations,omitempty"`
}

// ID returns the ID of the block, respecting the old and new field names.
func (b Block) ID() string {
	if b.ID_Good != "" {
		return b.ID_Good
	}

	return b.ID_Bad
}

// Attributes returns the attributes of the block, respecting the old and new field names.
func (b Block) Attributes() map[string]any {
	if len(b.Attributes_Old) > 0 {
		return b.Attributes_Old
	}

	return b.InlineAttributes_
}

// Annotation is a range of text that has a type and attributes.
type Annotation struct {
	Type string `mapstructure:"type"`
	Link string `mapstructure:"link,omitempty"`

	// We messed up the encoding of blocks in some comment early on,
	// so we have to be able to support the format forever.
	// In the old encoding the ID field was encoded as "iD",
	// and attributes that should be inlined with the top-level map
	// were encoded as a map inside of an "attributes" field.
	Attributes_Old    map[string]any `mapstructure:"attributes,omitempty"`
	InlineAttributes_ map[string]any `mapstructure:",remain"`

	Starts []int32 `mapstructure:"starts,omitempty"`
	Ends   []int32 `mapstructure:"ends,omitempty"`
}

// Attributes returns the attributes of the annotation, respecting the old and new field names.
func (a Annotation) Attributes() map[string]any {
	if len(a.Attributes_Old) > 0 {
		return a.Attributes_Old
	}

	return a.InlineAttributes_
}

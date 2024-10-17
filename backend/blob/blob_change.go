package blob

import (
	"bytes"
	"cmp"
	"encoding/binary"
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
	cbornode.RegisterCborType(Op{})
	cbornode.RegisterCborType(Block{})
	cbornode.RegisterCborType(Annotation{})
}

const blobTypeChange blobType = "Change"

// OpType is a type for operation types.
type OpType string

// Op is an atom of our op-based CRDT structure.
type Op struct {
	Type OpType         `refmt:"type"`
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
		Type: OpSetMetadata,
		Data: map[string]any{key: value}, // TODO(burdiyan): or key => key, value => value?
	}
}

// NewOpMoveBlock creates a MoveBlock op.
func NewOpMoveBlock(block, parent, leftOrigin string) Op {
	return Op{
		Type: OpMoveBlock,
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
		Type: OpReplaceBlock,
		Data: CBORToMap(state),
	}
}

// Change is an atomic change to a document.
// The linked DAG of Changes represents the state of a document over time.
type Change struct {
	baseBlob
	Genesis cid.Cid   `refmt:"genesis,omitempty"`
	Deps    []cid.Cid `refmt:"deps,omitempty"`
	Depth   int       `refmt:"depth,omitempty"`
	Ops     []Op      `refmt:"ops,omitempty"`
}

// NewChange creates a new Change.
func NewChange(kp core.KeyPair, genesis cid.Cid, deps []cid.Cid, depth int, ops []Op, ts time.Time) (eb Encoded[*Change], err error) {
	cc := &Change{
		baseBlob: baseBlob{
			Type:   blobTypeChange,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Genesis: genesis,
		Deps:    deps,
		Depth:   depth,
		Ops:     ops,
	}

	if err := signBlob(kp, cc, &cc.baseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

type OpID struct {
	Ts     uint64
	Idx    uint32
	Origin uint64
}

const (
	maxTimestamp = 1<<48 - 1
	maxIdx       = 1<<24 - 1
	maxOrigin    = 1<<48 - 1
)

func newOpID(ts uint64, idx uint32, origin uint64) OpID {
	if ts >= maxTimestamp {
		panic("BUG: operation timestamp is too large")
	}

	if idx >= maxIdx {
		panic("BUG: operation index is too large")
	}

	if origin >= maxOrigin {
		panic("BUG: operation origin is too large")
	}

	return OpID{
		Ts:     ts,
		Origin: origin,
		Idx:    idx,
	}
}

func (o OpID) Compare(oo OpID) int {
	if o.Ts < oo.Ts {
		return -1
	}

	if o.Ts > oo.Ts {
		return +1
	}

	if o.Idx < oo.Idx {
		return -1
	}

	if o.Idx > oo.Idx {
		return +1
	}

	return cmp.Compare(o.Origin, oo.Origin)
}

func (op OpID) Encode() EncodedOpID {
	var (
		e       EncodedOpID
		scratch [8]byte
	)

	binary.BigEndian.PutUint64(scratch[:], uint64(op.Ts))
	copy(e[:6], scratch[2:])

	binary.BigEndian.PutUint32(scratch[:], op.Idx)
	copy(e[6:6+3], scratch[1:])

	binary.BigEndian.PutUint64(scratch[:], op.Origin)
	copy(e[9:], scratch[2:])

	return e
}

// EncodedOpID is a CRDT Op ID that is compactly encoded in the following way:
// - 6 bytes (48 bits): timestamp. Enough precision to track Unix millisecond timestamps for thousands for years.
// - 3 bytes (24 bits): index/offset of the operation within the same Change/Transaction.
// - 6 bytes (48 bits): origin/replica/actor. Random 48-bit value of a replica that generated the operation.
// The timestamp and index are big-endian, to support lexicographic ordering of the IDs.
// This has some limitations:
// 1. Maximum number of operations in a single change is 16777215.
// 2. Same actor must not generate Changes/Transactions within the same millisecond.
// 3. The clocks on the devices generating the operations must be roughly syncronized to avoid inter-device conflicts in timestamps.
type EncodedOpID [15]byte

func (e EncodedOpID) Decode() OpID {
	var (
		out     OpID
		scratch [8]byte
	)

	copy(scratch[2:], e[:6])
	scratch[0] = 0
	scratch[1] = 0
	out.Ts = binary.BigEndian.Uint64(scratch[:])

	copy(scratch[1:], e[6:6+3])
	out.Idx = binary.BigEndian.Uint32(scratch[:5])

	copy(scratch[2:], e[9:])
	scratch[0] = 0
	scratch[1] = 0
	out.Origin = binary.BigEndian.Uint64(scratch[:])

	return out
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
		switch op.Type {
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

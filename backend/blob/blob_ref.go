package blob

import (
	"bytes"
	"fmt"
	"seed/backend/core"
	"seed/backend/ipfs"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

const blobTypeRef blobType = "Ref"

func init() {
	cbornode.RegisterCborType(Ref{})
}

// Ref is a blob that claims an entry for a path in a space
// to point to some other blobs, namely document changes.
// It's similar to a Git Ref, but is signed.
type Ref struct {
	baseBlob

	// Don't access field Space! Use GetSpace() method!

	Space       core.Principal `refmt:"space,omitempty"`
	Path        string         `refmt:"path,omitempty"`
	GenesisBlob cid.Cid        `refmt:"genesisBlob,omitempty"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Heads       []cid.Cid      `refmt:"heads"`
	Generation  int64          `refmt:"generation,omitempty"`
}

// NewRef creates a new Ref blob.
func NewRef(kp core.KeyPair, generation int64, genesis cid.Cid, space core.Principal, path string, heads []cid.Cid, capc cid.Cid, ts time.Time) (eb Encoded[*Ref], err error) {
	// TODO(burdiyan): we thought we wanted to attach caps to refs, then we figured out we were not doing it,
	// then we wanted to fix it, then we realized we haven't, and then we decided that it was never needed anyway.
	// So this should just go away, but we'll do it later.
	_ = capc

	ru := &Ref{
		baseBlob: baseBlob{
			Type:   blobTypeRef,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Path:        path,
		GenesisBlob: genesis,
		Heads:       heads,
		Generation:  generation,
	}

	if !kp.Principal().Equal(space) {
		ru.Space = space
	}

	if err := signBlob(kp, ru, &ru.baseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(ru)
}

// GetSpace returns the space the Ref is applied to.
func (r *Ref) GetSpace() core.Principal {
	if len(r.Space) == 0 {
		return r.Signer
	}

	return r.Space
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeRef)

	registerIndexer(blobTypeRef,
		func(c cid.Cid, data []byte) (*Ref, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Ref{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			if err := verifyBlob(v.Signer, v, &v.Sig); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexRef,
	)
}

func indexRef(ictx *indexingCtx, id int64, c cid.Cid, v *Ref) error {
	type Meta struct {
		Tombstone  bool  `json:"tombstone,omitempty"`
		Generation int64 `json:"generation,omitempty"`
	}

	space := v.GetSpace()

	iri, err := NewIRI(space, v.Path)
	if err != nil {
		return err
	}

	var sb StructuralBlob
	if v.Ts.Equal(unixZero) {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Signer, v.Ts, iri, v.GenesisBlob, space, v.Ts)
	} else {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Signer, v.Ts, iri, v.GenesisBlob, space, time.Time{})
	}

	if v.GenesisBlob.Defined() {
		sb.GenesisBlob = v.GenesisBlob
	}

	meta := Meta{
		Generation: v.Generation,
	}

	switch {
	// A normal Ref has to have Genesis and Heads.
	case v.GenesisBlob.Defined() && len(v.Heads) > 0:
	// A tombstone Ref must have Genesis and no Heads.
	case v.GenesisBlob.Defined() && len(v.Heads) == 0:
		meta.Tombstone = true
	// All the other cases are invalid.
	default:
		return fmt.Errorf("invalid Ref blob invariants %+v", v)
	}

	sb.Meta = meta

	for _, head := range v.Heads {
		sb.AddBlobLink("ref/head", head)
	}

	if v.Capability.Defined() {
		sb.AddBlobLink("ref/capability", v.Capability)
	}

	return ictx.SaveBlob(id, sb)
}

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
	cbornode.RegisterCborType(RefUnsigned{})
}

// Ref is a blob that claims an entry for a path in a space
// to point to some other blobs, namely document changes.
// It's similar to a Git Ref, but is signed.
type Ref struct {
	RefUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

// NewRef creates a new Ref blob.
func NewRef(kp core.KeyPair, genesis cid.Cid, space core.Principal, path string, heads []cid.Cid, ts time.Time) (eb Encoded[*Ref], err error) {
	ru := RefUnsigned{
		Type:        blobTypeRef,
		Space:       space,
		Path:        path,
		GenesisBlob: genesis,
		Heads:       heads,
		Author:      kp.Principal(),
		Ts:          ts,
	}

	cc, err := ru.Sign(kp)
	if err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

// RefUnsigned holds the fields of a Ref that are meant to be signed.
type RefUnsigned struct {
	Type        blobType       `refmt:"type"`
	Space       core.Principal `refmt:"space"`
	Path        string         `refmt:"path,omitempty"`
	GenesisBlob cid.Cid        `refmt:"genesisBlob"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Heads       []cid.Cid      `refmt:"heads"`
	Author      core.Principal `refmt:"author"`
	Ts          time.Time      `refmt:"ts"`
}

// Sign the ref blob with the provided key pair.
func (r *RefUnsigned) Sign(kp core.KeyPair) (rr *Ref, err error) {
	if !r.Author.Equal(kp.Principal()) {
		return nil, fmt.Errorf("author mismatch when signing")
	}

	data, err := cbornode.DumpObject(r)
	if err != nil {
		return nil, err
	}

	sig, err := kp.Sign(data)
	if err != nil {
		return nil, err
	}

	return &Ref{
		RefUnsigned: *r,
		Sig:         sig,
	}, nil
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

			return v, nil
		},
		indexRef,
	)
}

func indexRef(ictx *indexingCtx, id int64, c cid.Cid, v *Ref) error {
	// TODO(hm24): more validation and refs for docs.

	iri, err := NewIRI(v.Space, v.Path)
	if err != nil {
		return err
	}

	var sb StructuralBlob
	if v.Ts.Equal(unixZero) {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Author, v.Ts, iri, v.GenesisBlob, v.Author, v.Ts)
	} else {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Author, v.Ts, iri, v.GenesisBlob, nil, time.Time{})
	}

	if len(v.Heads) == 0 {
		return fmt.Errorf("ref blob must have heads")
	}

	for _, head := range v.Heads {
		sb.AddBlobLink("ref/head", head)
	}

	if v.Capability.Defined() {
		sb.AddBlobLink("ref/capability", v.Capability)
	}

	return ictx.SaveBlob(id, sb)
}

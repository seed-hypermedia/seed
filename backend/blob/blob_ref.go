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
	GenesisBlob cid.Cid        `refmt:"genesisBlob"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Heads       []cid.Cid      `refmt:"heads"`
}

// NewRef creates a new Ref blob.
func NewRef(kp core.KeyPair, genesis cid.Cid, space core.Principal, path string, heads []cid.Cid, cap cid.Cid, ts time.Time) (eb Encoded[*Ref], err error) {
	ru := &Ref{
		baseBlob: baseBlob{
			Type:   blobTypeRef,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Path:        path,
		GenesisBlob: genesis,
		Heads:       heads,
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
	// TODO(hm24): more validation and refs for docs.

	iri, err := NewIRI(v.GetSpace(), v.Path)
	if err != nil {
		return err
	}

	var sb StructuralBlob
	if v.Ts.Equal(unixZero) {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Signer, v.Ts, iri, v.GenesisBlob, v.Signer, v.Ts)
	} else {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Signer, v.Ts, iri, v.GenesisBlob, nil, time.Time{})
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

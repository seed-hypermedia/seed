package blob

import (
	"bytes"
	"seed/backend/core"
	"seed/backend/ipfs"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

const blobTypeCapability blobType = "Capability"

func init() {
	cbornode.RegisterCborType(Capability{})
}

// Capability is a blob that represents some granted rights from the issuer to the delegate key.
type Capability struct {
	baseBlob
	Delegate    core.Principal `refmt:"delegate"`
	Spc         core.Principal `refmt:"space,omitempty"` // if empty, then signer is the space.
	Path        string         `refmt:"path,omitempty"`
	Role        string         `refmt:"role"`
	NoRecursive bool           `refmt:"noRecursive,omitempty"`
}

// NewCapability creates a new Capability blob.
func NewCapability(issuer core.KeyPair, delegate, space core.Principal, path string, role string, ts time.Time, noRecursive bool) (eb Encoded[*Capability], err error) {
	cu := &Capability{
		baseBlob: baseBlob{
			Type:   blobTypeCapability,
			Signer: issuer.Principal(),
			Ts:     ts,
		},
		Delegate:    delegate,
		Path:        path,
		Role:        role,
		NoRecursive: noRecursive,
	}

	if !issuer.Principal().Equal(space) {
		cu.Spc = space
	}

	if err := SignBlob(issuer, cu, &cu.baseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

// GetSpace returns the space of the capability.
// Normally it's the same as the signer, but can be different in case of nested delegations.
func (c *Capability) GetSpace() core.Principal {
	if len(c.Spc) == 0 {
		return c.Signer
	}
	return c.Spc
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeCapability)
	registerIndexer(blobTypeCapability,
		func(c cid.Cid, data []byte) (*Capability, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Capability{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexCapability,
	)
}

func indexCapability(ictx *indexingCtx, id int64, c cid.Cid, v *Capability) error {
	iri, err := NewIRI(v.GetSpace(), v.Path)
	if err != nil {
		return err
	}

	sb := newStructuralBlob(c, string(blobTypeCapability), v.Signer, v.Ts, iri, cid.Undef, v.GetSpace(), time.Time{})

	if _, err := ictx.ensurePubKey(v.Signer); err != nil {
		return err
	}

	del, err := ictx.ensurePubKey(v.Delegate)
	if err != nil {
		return err
	}

	sb.Meta = map[string]any{
		"role": v.Role,
		"del":  del,
	}

	return ictx.SaveBlob(id, sb)
}

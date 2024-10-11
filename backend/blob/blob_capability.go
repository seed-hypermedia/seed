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

const blobTypeCapability blobType = "Capability"

func init() {
	cbornode.RegisterCborType(Capability{})
	cbornode.RegisterCborType(CapabilityUnsigned{})
}

// Capability is a blob that represents some granted rights from the issuer to the delegate key.
type Capability struct {
	CapabilityUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

// CapabilityUnsigned holds the fields of a Capability that are meant to be signed.
type CapabilityUnsigned struct {
	Type        blobType       `refmt:"type"`
	Issuer      core.Principal `refmt:"issuer"`
	Delegate    core.Principal `refmt:"delegate"`
	Space       core.Principal `refmt:"space"`
	Path        string         `refmt:"path,omitempty"`
	Role        string         `refmt:"role"`
	Ts          time.Time      `refmt:"ts"`
	NoRecursive bool           `refmt:"noRecursive,omitempty"`
}

// NewCapability creates a new Capability blob.
func NewCapability(issuer core.KeyPair, delegate, space core.Principal, path string, role string, ts time.Time, noRecursive bool) (eb Encoded[*Capability], err error) {
	cu := CapabilityUnsigned{
		Type:        blobTypeCapability,
		Issuer:      issuer.Principal(),
		Delegate:    delegate,
		Space:       space,
		Path:        path,
		Role:        role,
		Ts:          ts,
		NoRecursive: noRecursive,
	}

	cc, err := cu.Sign(issuer)
	if err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

// Sign signs the Capability with the given key pair.
func (c CapabilityUnsigned) Sign(kp core.KeyPair) (cc *Capability, err error) {
	if !kp.Principal().Equal(c.Issuer) {
		return cc, fmt.Errorf("signing key %s must be equal to issuer %s", kp.Principal(), c.Issuer)
	}

	data, err := cbornode.DumpObject(c)
	if err != nil {
		return nil, err
	}

	sig, err := kp.Sign(data)
	if err != nil {
		return nil, err
	}

	cc = &Capability{
		CapabilityUnsigned: c,
		Sig:                sig,
	}

	return cc, nil
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
	iri, err := NewIRI(v.Space, v.Path)
	if err != nil {
		return err
	}

	sb := newStructuralBlob(c, string(blobTypeCapability), v.Issuer, v.Ts, iri, cid.Undef, v.Space, time.Time{})

	if _, err := ictx.ensurePubKey(v.Issuer); err != nil {
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

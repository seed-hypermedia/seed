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

const blobTypeProfile blobType = "Profile"

func init() {
	cbornode.RegisterCborType(Profile{})
}

// Profile is a blob that represents a user profile.
// It has snapshot-like behavior similar to Refs,
// i.e. only last version is kept per key.
type Profile struct {
	baseBlob

	Alias core.Principal `refmt:"alias,omitempty"`
}

// NewProfileAlias creates a new alias Profile blob.
func NewProfileAlias(issuer *core.KeyPair, alias core.Principal, ts time.Time) (eb Encoded[*Profile], err error) {
	p := &Profile{
		baseBlob: baseBlob{
			Type:   blobTypeProfile,
			Signer: issuer.Principal(),
			Ts:     ts,
		},
		Alias: alias,
	}

	if err := signBlob(issuer, p, &p.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(p)
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeProfile)
	registerIndexer(blobTypeProfile,
		func(c cid.Cid, data []byte) (*Profile, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Profile{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			if err := verifyBlob(v.Signer, v, v.Sig); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexProfile,
	)
}

func indexProfile(ictx *indexingCtx, _ int64, c cid.Cid, v *Profile) error {
	iri, err := NewIRI(v.Signer, "")
	if err != nil {
		return err
	}

	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, v.Signer, time.Time{})

	if len(v.Alias) == 0 {
		return fmt.Errorf("profile blobs only support aliases now, but got empty alias")
	}

	signer, err := ictx.ensurePubKey(v.Signer)
	if err != nil {
		return err
	}

	alias, err := ictx.ensurePubKey(v.Alias)
	if err != nil {
		return err
	}

	ok, err := isValidAgentKey(ictx.conn, alias, signer)
	if err != nil {
		return err
	}

	if !ok {
		return fmt.Errorf("alias profile must have the corresponding capability before already indexed")
	}

	sb.ExtraAttrs = map[string]any{
		"alias": alias,
	}

	return ictx.SaveBlob(sb)
}

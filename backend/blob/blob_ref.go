package blob

import (
	"bytes"
	"fmt"
	"seed/backend/core"
	"seed/backend/hlc"
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

type Ref struct {
	RefUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

func NewRef(kp core.KeyPair, genesis cid.Cid, rid IRI, heads []cid.Cid, ts int64) (eb Encoded[*Ref], err error) {
	ru := RefUnsigned{
		Type:        blobTypeRef,
		Resource:    rid,
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

type RefUnsigned struct {
	Type        blobType       `refmt:"@type"`
	Resource    IRI            `refmt:"resource"`
	GenesisBlob cid.Cid        `refmt:"genesisBlob"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Heads       []cid.Cid      `refmt:"heads"`
	Author      core.Principal `refmt:"author"`
	Ts          int64          `refmt:"ts"`
}

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

	var sb StructuralBlob
	if v.Ts == ProfileGenesisEpoch {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Author, hlc.Timestamp(v.Ts).Time(), v.Resource, v.GenesisBlob, v.Author, hlc.Timestamp(v.Ts).Time())
	} else {
		sb = newStructuralBlob(c, string(blobTypeRef), v.Author, hlc.Timestamp(v.Ts).Time(), v.Resource, v.GenesisBlob, nil, time.Time{})
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

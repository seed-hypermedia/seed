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

const blobTypeContact blobType = "Contact"

const contactNameMaxLength = 256

// Contact is a blob that
type Contact struct {
	BaseBlob

	Genesis cid.Cid `refmt:"genesis,omitempty"`

	// Subject is the account that's being described by the contact record.
	Subject core.Principal `refmt:"subject,omitempty"`

	// Name is the public name of the contact that we know them by.
	Name string `refmt:"name,omitempty"`
}

// NewContact creates a new Contact blob.
func NewContact(kp *core.KeyPair, genesis cid.Cid, subject core.Principal, name string, ts time.Time) (eb Encoded[*Contact], err error) {
	cu := &Contact{
		BaseBlob: BaseBlob{
			Type:   blobTypeContact,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Genesis: genesis,
		Subject: subject,
		Name:    name,
	}

	if err = signBlob(kp, cu, &cu.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

func init() {
	cbornode.RegisterCborType(Contact{})

	matcher := makeCBORTypeMatch(blobTypeContact)
	registerIndexer(blobTypeContact,
		func(c cid.Cid, data []byte) (*Contact, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Contact{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			if err := verifyBlob(v.Signer, v, v.Sig); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexContact,
	)
}

func indexContact(ictx *indexingCtx, id int64, c cid.Cid, v *Contact) error {
	if v.Name == "" {
		return fmt.Errorf("contacts must have a name")
	}

	if len(v.Name) > contactNameMaxLength {
		return fmt.Errorf("contact name exceeds maximum length of %d characters", contactNameMaxLength)
	}

	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, "", cid.Undef, v.Signer, time.Time{})

	subjectID, err := ictx.ensurePubKey(v.Subject)
	if err != nil {
		return fmt.Errorf("failed to ensure subject public key: %w", err)
	}

	sb.ExtraAttrs = map[string]any{
		"subject": subjectID,
		"name":    v.Name,
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return fmt.Errorf("failed to save structural blob: %w", err)
	}

	return nil
}

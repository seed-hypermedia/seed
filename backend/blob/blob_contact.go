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

// TypeContact is the type of the Contact blob.
const TypeContact Type = "Contact"

const contactNameMaxLength = 256

// Contact is a blob that
type Contact struct {
	BaseBlob

	// ID of the contact within the signer's authority that's being replaced.
	// Only present on contact updates.
	//
	// TODO(burdiyan): figure out how to handle delegated signers.
	ID TSID `refmt:"id,omitempty"`

	// Subject is the account that's being described by the contact record.
	Subject core.Principal `refmt:"subject,omitempty"`

	// Name is the public name of the contact that we know them by.
	Name string `refmt:"name,omitempty"`
}

// NewContact creates a new Contact blob.
func NewContact(kp *core.KeyPair, id TSID, subject core.Principal, name string, ts time.Time) (eb Encoded[*Contact], err error) {
	cu := &Contact{
		BaseBlob: BaseBlob{
			Type:   TypeContact,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		ID:      id,
		Subject: subject,
		Name:    name,
	}

	if err = signBlob(kp, cu, &cu.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

// TSID implement [ReplacementBlob] interface.
func (c *Contact) TSID() TSID {
	return c.ID
}

func init() {
	cbornode.RegisterCborType(Contact{})

	matcher := makeCBORTypeMatch(TypeContact)
	registerIndexer(TypeContact,
		func(c cid.Cid, data []byte) (eb Encoded[*Contact], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return eb, errSkipIndexing
			}

			v := &Contact{}
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
		indexContact,
	)
}

func indexContact(ictx *indexingCtx, id int64, eb Encoded[*Contact]) error {
	c, v := eb.CID, eb.Decoded

	// Validate contact: either both name and subject are present, or both are empty (tombstone)
	var isTombstone bool
	switch {
	case v.Name != "" && len(v.Subject) > 0:
		if len(v.Name) > contactNameMaxLength {
			return fmt.Errorf("contact name exceeds maximum length of %d characters", contactNameMaxLength)
		}
	case v.Name == "" && len(v.Subject) == 0:
		isTombstone = true
	default:
		return fmt.Errorf("contacts must have either both name and subject, or neither (for tombstones)")
	}

	// TODO(burdiyan): temporarily we associate contacts with the resource of the Home document.
	iri, err := NewIRI(v.Signer, "")
	if err != nil {
		return err
	}

	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, v.Signer, time.Time{})

	extraAttrs := map[string]any{
		"tsid": eb.TSID(),
	}

	// For active contacts, add subject and name
	if !isTombstone {
		subjectID, err := ictx.ensurePubKey(v.Subject)
		if err != nil {
			return fmt.Errorf("failed to ensure subject public key: %w", err)
		}
		extraAttrs["subject"] = subjectID
		extraAttrs["name"] = v.Name
		if err := dbFTSInsertOrReplace(ictx.conn, v.Name, "contact", id, "", sb.CID.String()); err != nil {
			return fmt.Errorf("failed to insert record in fts table: %w", err)
		}
	} else {
		// For tombstones, mark as deleted
		extraAttrs["deleted"] = true
	}

	sb.ExtraAttrs = extraAttrs

	if err := ictx.SaveBlob(sb); err != nil {
		return fmt.Errorf("failed to save structural blob: %w", err)
	}

	return nil
}

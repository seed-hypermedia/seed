package blob

import (
	"bytes"
	"fmt"
	"seed/backend/core"
	"seed/backend/ipfs"
	"strings"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

// TypeCapability is the type of the Capability blob.
const TypeCapability Type = "Capability"

const labelLimitBytes = 512

// Role is a type for roles in capabilities.
type Role string

// Role values.
//
// We use ALL_CAPS notation for backward compatibility with the old code,
// which was using string representations of the Protobuf enums.
// Everywhere else in the permanent data we use PascalNotation for the string enum-like values.
// Eventually we could probably do a migration to gain better consistency.
const (
	RoleWriter Role = "WRITER"
	RoleAgent  Role = "AGENT"
)

// Capability is a blob that represents some granted rights from the issuer to the delegate key.
type Capability struct {
	BaseBlob
	Delegate core.Principal `refmt:"delegate"`
	Path     string         `refmt:"path,omitempty"`
	Role     Role           `refmt:"role,omitempty"`
	Label    string         `refmt:"label,omitempty"`
}

// NewCapability creates a new Capability blob.
func NewCapability(issuer *core.KeyPair, delegate, space core.Principal, path string, role Role, label string, ts time.Time) (eb Encoded[*Capability], err error) {
	cu := &Capability{
		BaseBlob: BaseBlob{
			Type:   TypeCapability,
			Signer: issuer.Principal(),
			Ts:     ts,
		},
		Delegate: delegate,
		Path:     path,
		Role:     role,
		Label:    label,
	}

	if !issuer.Principal().Equal(space) {
		return eb, fmt.Errorf("BUG: capabilities can only be signed by the space owner key")
	}

	if err := signBlob(issuer, cu, &cu.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

// Space returns the space of the capability.
// Normally it's the same as the signer, but can be different in case of nested delegations.
func (c *Capability) Space() core.Principal {
	return c.Signer
}

// ValidateCapabilityLabel checks the validity of a capability label.
func ValidateCapabilityLabel(label string) error {
	if label == "" {
		return nil
	}

	if len(label) > labelLimitBytes {
		return fmt.Errorf("capability label '%s' exceeds the maximum allowed limit of %d bytes", label, labelLimitBytes)
	}

	if strings.TrimSpace(label) != label {
		return fmt.Errorf("capability label '%s' must not contain leading or trailing spaces", label)
	}

	return nil
}

func init() {
	cbornode.RegisterCborType(Capability{})

	matcher := makeCBORTypeMatch(TypeCapability)
	registerIndexer(TypeCapability,
		func(c cid.Cid, data []byte) (eb Encoded[*Capability], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return eb, errSkipIndexing
			}

			v := &Capability{}
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
		indexCapability,
	)
}

func indexCapability(ictx *indexingCtx, _ int64, eb Encoded[*Capability]) error {
	c, v := eb.CID, eb.Decoded

	iri, err := NewIRI(v.Space(), v.Path)
	if err != nil {
		return err
	}

	// Capabilities are public by default and don't have explicit visibility field.
	sb := newStructuralBlob(c, eb.Decoded.Type, v.Signer, v.Ts, iri, cid.Undef, v.Space(), time.Time{}, VisibilityPublic)

	if _, err := ictx.ensurePubKey(v.Signer); err != nil {
		return err
	}

	del, err := ictx.ensurePubKey(v.Delegate)
	if err != nil {
		return err
	}

	if v.Role == RoleAgent {
		if v.Path != "" {
			return fmt.Errorf("agent capabilities cannot be tied to a specific path")
		}
	}

	// Ensuring reasonable limits on the label size, to avoid abuse.
	// The limit is quite arbitrary though.
	if err := ValidateCapabilityLabel(v.Label); err != nil {
		return err
	}

	sb.ExtraAttrs = map[string]any{
		"role": v.Role,
		"del":  del,
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	return reindexStashedBlobs(ictx.mustTrackUnreads, ictx.conn, stashReasonPermissionDenied, v.Delegate.String(), ictx.blockStore, ictx.log)
}

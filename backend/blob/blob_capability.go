package blob

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/strbytes"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

const blobTypeCapability blobType = "Capability"

func init() {
	cbornode.RegisterCborType(Capability{})
}

var labelPattern = regexp.MustCompile(`^[a-zA-Z0-9\s]+$`)

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
	RoleSubkey Role = "SUBKEY"
)

// Capability is a blob that represents some granted rights from the issuer to the delegate key.
type Capability struct {
	baseBlob
	Delegate core.Principal `refmt:"delegate"`
	Path     string         `refmt:"path,omitempty"`
	Role     Role           `refmt:"role,omitempty"`
	Label    string         `refmt:"label,omitempty"`
}

// NewCapability creates a new Capability blob.
func NewCapability(issuer *core.KeyPair, delegate, space core.Principal, path string, role Role, label string, ts time.Time) (eb Encoded[*Capability], err error) {
	cu := &Capability{
		baseBlob: baseBlob{
			Type:   blobTypeCapability,
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

	if err := signBlob(issuer, cu, &cu.baseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

// Space returns the space of the capability.
// Normally it's the same as the signer, but can be different in case of nested delegations.
func (c *Capability) Space() core.Principal {
	return c.Signer
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

			if err := verifyBlob(v.Signer, v, v.Sig); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexCapability,
	)
}

func indexCapability(ictx *indexingCtx, id int64, c cid.Cid, v *Capability) error {
	iri, err := NewIRI(v.Space(), v.Path)
	if err != nil {
		return err
	}

	sb := newStructuralBlob(c, string(blobTypeCapability), v.Signer, v.Ts, iri, cid.Undef, v.Space(), time.Time{})

	if _, err := ictx.ensurePubKey(v.Signer); err != nil {
		return err
	}

	del, err := ictx.ensurePubKey(v.Delegate)
	if err != nil {
		return err
	}

	// Ensuring reasonable limits on the label size, to avoid abuse.
	// The limit is quite arbitrary though.
	const labelLimit = 512
	if len(v.Label) > labelLimit {
		return fmt.Errorf("capability label '%s' exceeds the maximum allowed limit of %d bytes", v.Label, labelLimit)
	}

	if v.Label != "" && !labelPattern.MatchString(v.Label) {
		return fmt.Errorf("capability label '%s' contains invalid characters", v.Label)
	}

	sb.ExtraAttrs = map[string]any{
		"role": v.Role,
		"del":  del,
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	refs, err := loadRefsForCapability(ictx.conn, ictx.blockStore, del, iri, true)
	if err != nil {
		return err
	}

	for _, ref := range refs {
		if err := crossLinkRefMaybe(
			// TODO(burdiyan): doing some ugly stuff here. We need a new indexing context,
			// because now we are trying to index a Ref blob that might be related to the change we are currently indexing.
			// Currently the indexing context is tied to a single blob, but it shouldn't be this way.
			// There's more code like this. Search for (#ictxDRY).
			newCtx(ictx.conn, ref.ID, ictx.blockStore, ictx.log),
			ref.Value,
		); err != nil {
			return err
		}
	}

	return nil
}

func loadRefsForCapability(conn *sqlite.Conn, bs *blockStore, delegate int64, iri IRI, recursive bool) ([]decodedBlob[*Ref], error) {
	var crumbsJSON string
	{
		data, err := json.Marshal(iri.Breadcrumbs())
		if err != nil {
			return nil, err
		}
		crumbsJSON = strbytes.String(data)
	}

	var iriGlob string
	if recursive {
		iriGlob = string(iri) + "/*"
	}

	var out []decodedBlob[*Ref]
	rows, check := sqlitex.Query(conn, qLoadRefsForCapability(), delegate, crumbsJSON, iriGlob)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			id        = row.ColumnInt64(inc())
			codec     = row.ColumnInt64(inc())
			multihash = row.ColumnBytes(inc())
			rawData   = row.ColumnBytesUnsafe(inc())
			size      = row.ColumnInt64(inc())
		)

		data, err := bs.decompress(rawData, int(size))
		if err != nil {
			return nil, err
		}

		ref := &Ref{}
		if err := cbornode.DecodeInto(data, &ref); err != nil {
			return nil, err
		}
		out = append(out, decodedBlob[*Ref]{
			ID:    id,
			CID:   cid.NewCidV1(uint64(codec), multihash),
			Value: ref,
		})
	}

	err := check()
	if err != nil {
		return nil, err
	}

	return out, nil
}

var qLoadRefsForCapability = dqb.Str(`
	SELECT
		blobs.id,
		blobs.codec,
		blobs.multihash,
		blobs.data,
		blobs.size
	FROM structural_blobs sb
	JOIN blobs ON blobs.id = sb.id
	WHERE sb.type = 'Ref'
	AND sb.author = :delegate
	AND sb.resource IN (
		SELECT resources.id
		FROM resources, json_each(:iris) AS iris
		WHERE resources.iri = iris.value
		UNION
		SELECT resources.id FROM resources WHERE iri GLOB :iriGlob
	)
`)

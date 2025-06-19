package blob

import (
	"bytes"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/sqlite/sqlitex"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

const (
	maxProfileDescriptionLen = 512
)

const blobTypeProfile Type = "Profile"

func init() {
	cbornode.RegisterCborType(Profile{})
}

// URI is a named type for a URI string.
type URI string

// Profile is a blob that represents a user profile.
// It has snapshot-like behavior similar to Refs,
// i.e. only last version is kept per key.
type Profile struct {
	BaseBlob

	// Alias can point to another key, which acts as an "identity redirect".
	// There has to be a valid AGENT capability for the alias to be valid.
	// If alias is specified, all the other fields should be ignored (ideally unset, but we don't validate that now).
	Alias core.Principal `refmt:"alias,omitempty"`

	// The following fields may not have the best names,
	// but we left them to be consistent with the fields on the root document
	// we used to use for profile data.

	// Name for the profile.
	Name string `refmt:"name,omitempty"`

	// Icon or avatar for the profile.
	Icon URI `refmt:"avatar,omitempty"`

	// Description is a short text describing the profile.
	Description string `refmt:"description,omitempty"`

	// Account is the account ID for which the profile is defined.
	// It's not specified if it's the same as the signer,
	// only when an agent key modifies the profile of their "parent".
	Account core.Principal `refmt:"account,omitempty"`
}

// NewProfileAlias creates a new alias Profile blob.
func NewProfileAlias(kp *core.KeyPair, alias core.Principal, ts time.Time) (eb Encoded[*Profile], err error) {
	p := &Profile{
		BaseBlob: BaseBlob{
			Type:   blobTypeProfile,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Alias: alias,
	}

	if err := signBlob(kp, p, &p.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(p)
}

// NewProfile creates a new Profile blob.
func NewProfile(kp *core.KeyPair, name string, icon URI, description string, account core.Principal, ts time.Time) (eb Encoded[*Profile], err error) {
	if account == nil {
		return eb, fmt.Errorf("account cannot be nil")
	}

	if kp.Principal().Equal(account) {
		account = nil
	}

	p := &Profile{
		BaseBlob: BaseBlob{
			Type:   blobTypeProfile,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Name:        name,
		Icon:        icon,
		Description: description,
		Account:     account,
	}

	if err := signBlob(kp, p, &p.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(p)
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeProfile)
	registerIndexer(blobTypeProfile,
		func(c cid.Cid, data []byte) (eb Encoded[*Profile], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return eb, errSkipIndexing
			}

			v := &Profile{}
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
		indexProfile,
	)
}

func indexProfile(ictx *indexingCtx, id int64, eb Encoded[*Profile]) error {
	c, v := eb.CID, eb.Decoded

	iri, err := NewIRI(v.Signer, "")
	if err != nil {
		return err
	}

	owner := v.Signer
	if v.Account != nil {
		owner = v.Account
		iri, err = NewIRI(v.Account, "")
		if err != nil {
			return err
		}
	}

	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, owner, time.Time{})

	signer, err := ictx.ensurePubKey(v.Signer)
	if err != nil {
		return err
	}

	// TODO(burdiyan): improve these validations to make them more declarative and easier to understand.
	// Possibly we should validate during unmarshaling with some custom unmarshaler.
	const ftsType = "profile"
	var ftsContent string
	if v.Alias == nil {
		if v.Account != nil {
			v.Account, err = core.DecodePrincipal([]byte(v.Account))
			if err != nil {
				return err
			}

			subject, err := ictx.ensurePubKey(v.Account)
			if err != nil {
				return err
			}

			ok, err := isValidAgentKey(ictx.conn, subject, signer)
			if err != nil {
				return err
			}

			if !ok {
				return fmt.Errorf("delegated profile signer must have a valid agent capability")
			}
		}

		if v.Name == "" {
			return fmt.Errorf("non-alias profiles must have a name")
		}

		meta := map[string]string{
			"name": v.Name,
		}
		sb.ExtraAttrs = meta

		if v.Icon != "" {
			u, err := url.Parse(string(v.Icon))
			if err != nil {
				return fmt.Errorf("profile icon must be a valid URI: %w", err)
			}

			if u.Scheme != "ipfs" {
				return fmt.Errorf("profile icon must be an IPFS URI")
			}

			c, err := cid.Decode(u.Host)
			if err != nil {
				return fmt.Errorf("profile icon URI must be a valid IPFS CID: %w", err)
			}

			sb.AddBlobLink("profile/icon", c)

			meta["icon"] = string(v.Icon)
		}

		if v.Description != "" {
			if len(v.Description) == maxProfileDescriptionLen {
				return fmt.Errorf("profile description must be less than %d characters", maxProfileDescriptionLen)
			}

			meta["description"] = v.Description
		}
		ftsContent = v.Name
	} else {
		v.Alias, err = core.DecodePrincipal([]byte(v.Alias))
		if err != nil {
			return err
		}

		if v.Name != "" {
			return fmt.Errorf("profile name must be absent when alias is defined")
		}

		if v.Icon != "" {
			return fmt.Errorf("profile icon must be absent when alias is defined")
		}

		if v.Description != "" {
			return fmt.Errorf("profile description must be absent when alias is defined")
		}

		if v.Account != nil {
			return fmt.Errorf("profile account ID must be absent when alias is defined")
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
	}

	if err := sqlitex.Exec(ictx.conn, "INSERT OR IGNORE INTO SPACES (id) VALUES (?)", nil, owner.String()); err != nil {
		return fmt.Errorf("failed to insert space: %w", err)
	}
	if err := ictx.SaveBlob(sb); err != nil {
		return fmt.Errorf("failed to save structural blob: %w", err)
	}

	if ftsContent != "" {
		if err := dbFTSInsertOrReplace(ictx.conn, ftsContent, ftsType, id, "", sb.CID.String()); err != nil {
			return fmt.Errorf("failed to insert record in fts table: %w", err)
		}
	}
	return nil
}

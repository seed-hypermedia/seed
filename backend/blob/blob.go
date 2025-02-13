// Package blob defines our core blob types for the permanent data layer.
package blob

import (
	"seed/backend/core"
	"seed/backend/util/cclock"
	"slices"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/polydawn/refmt/obj/atlas"
)

// ClockPrecision is the default precision we use for our timestaps in permanent data.
// It corresponds to the precision in the cclock package.
// This must be the same as precision used in the encoder/decoder transformation bellow.
const ClockPrecision = cclock.DefaultPrecision

func init() {
	// Encode timestamps as Unix milliseconds. Should be enough precision.
	cbornode.RegisterCborType(atlas.BuildEntry(time.Time{}).
		Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(t time.Time) (int64, error) {
			if !t.Equal(t.Round(ClockPrecision)) {
				panic("BUG: trying to encode a non-rounded time.Time")
			}

			return t.UnixMilli(), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in int64) (time.Time, error) {
			return time.UnixMilli(in), nil
		})).
		Complete(),
	)

	cbornode.RegisterCborType(atlas.BuildEntry(core.PublicKey{}).
		Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(v core.PublicKey) ([]byte, error) {
			return v.Bytes(), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in []byte) (core.PublicKey, error) {
			return core.DecodePublicKey(in)
		})).
		Complete(),
	)
}

var unixZero = time.Unix(0, 0).UTC().Round(ClockPrecision)

// ZeroUnixTime returns a zero timestamp.
// We use it whenever we need determinism in data that has timestamps.
// Namely, we use it to create a sentinel genesis Change for all the Account/Space home documents.
func ZeroUnixTime() time.Time {
	return unixZero
}

// cborToMap converts a CBOR object to a map.
// TODO(burdiyan): This is a workaround. Should not exist.
func cborToMap(v any) map[string]any {
	data, err := cbornode.DumpObject(v)
	if err != nil {
		panic(err)
	}

	var m map[string]any
	if err := cbornode.DecodeInto(data, &m); err != nil {
		panic(err)
	}

	return m
}

// mapToCBOR converts a map to a CBOR object.
// TODO(burdiyan): This is a workaround. Should not exist.
func mapToCBOR(data map[string]any, v any) {
	rawData, err := cbornode.DumpObject(data)
	if err != nil {
		panic(err)
	}

	if err := cbornode.DecodeInto(rawData, v); err != nil {
		panic(err)
	}
}

type baseBlob struct {
	Type    blobType       `refmt:"type"`
	Author_ core.Principal `refmt:"author,omitempty"`
	Signer  core.Principal `refmt:"signer"`
	Sig     core.Signature `refmt:"sig"`
	Ts      time.Time      `refmt:"ts"`
}

// Author returns the author of the blob.
// Normally it's just the signer, but for delegated signatures there's a dedicated author field.
func (b baseBlob) Author() core.Principal {
	if len(b.Author_) == 0 {
		return b.Signer
	}

	return b.Author_
}

// signBlob and fill in the signature.
func signBlob(kp *core.KeyPair, v any, sig *core.Signature) error {
	// Unlike some other projects that use a nil signature or omit the field entirely for signing,
	// we fill the space for the signature with zeros.
	// This leaves us room for optimizations to avoid double-serialization:
	// We could replace the pattern of zeros with the resulting signature, instead of serializing the data again.
	// TODO(burdiyan): no time to do this now. Maybe later.
	*sig = make([]byte, kp.SignatureSize())

	unsignedBytes, err := cbornode.DumpObject(v)
	if err != nil {
		return err
	}

	*sig, err = kp.Sign(unsignedBytes)
	return err
}

// verifyBlob checks the signature of a blob.
func verifyBlob(pubkey core.Principal, v any, sig *core.Signature) error {
	signer, err := pubkey.Parse()
	if err != nil {
		return err
	}

	sigCopy := slices.Clone(*sig)

	*sig = make([]byte, signer.SignatureSize())

	unsignedBytes, err := cbornode.DumpObject(v)
	if err != nil {
		return err
	}

	if err := signer.Verify(unsignedBytes, sigCopy); err != nil {
		return err
	}

	*sig = sigCopy

	return nil
}

// WithCID is a type for a decoded blob with its CID.
// Because blobs are content-addressed, they don't contain their own ID,
// so when you decode them, you somehow need to separately carry their IDs if you need to.
// This type provides a unified way of doing this.
type WithCID[T any] struct {
	CID   cid.Cid
	Value T
}

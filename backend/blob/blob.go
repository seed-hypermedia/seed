// Package blob defines our core blob types for the permanent data layer.
package blob

import (
	"seed/backend/core"
	"seed/backend/util/cclock"
	"time"

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
				panic("BUG: trying to encoded a non-rounded time.Time")
			}

			return t.UnixMilli(), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in int64) (time.Time, error) {
			return time.UnixMilli(in), nil
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

// CBORToMap converts a CBOR object to a map.
// TODO(burdiyan): This is a workaround. Should not exist.
func CBORToMap(v any) map[string]any {
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

// MapToCBOR converts a map to a CBOR object.
// TODO(burdiyan): This is a workaround. Should not exist.
func MapToCBOR(data map[string]any, v any) {
	rawData, err := cbornode.DumpObject(data)
	if err != nil {
		panic(err)
	}

	if err := cbornode.DecodeInto(rawData, v); err != nil {
		panic(err)
	}
}

// SignBlob and fill in the signature.
func SignBlob(kp core.KeyPair, v any, sig *core.Signature) error {
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

type baseBlob struct {
	Type   blobType       `refmt:"type"`
	Signer core.Principal `refmt:"signer"`
	Sig    core.Signature `refmt:"sig"`
	Ts     time.Time      `refmt:"ts"`
}

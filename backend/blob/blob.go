// Package blob defines our core blob types for the permanent data layer.
package blob

import (
	"errors"
	"fmt"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/cclock"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multicodec"
	"github.com/polydawn/refmt/obj/atlas"
)

// ClockPrecision is the default precision we use for our timestaps in permanent data.
// It corresponds to the precision in the cclock package.
// This must be the same as precision used in the encoder/decoder transformation below.
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
			t := time.UnixMilli(in)
			if !t.Equal(t.Round(ClockPrecision)) {
				return time.Time{}, fmt.Errorf("decoded time is not rounded to the correct precision")
			}

			return t, nil
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

	cbornode.RegisterCborType(atlas.BuildEntry(peer.ID("")).
		Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(v peer.ID) ([]byte, error) {
			return v.MarshalBinary()
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in []byte) (peer.ID, error) {
			var pid peer.ID
			return pid, pid.UnmarshalBinary(in)
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

// Type is a named type alias for blob types.
type Type string

// Blob is a common interface for our blobs.
type Blob interface {
	BlobTime() time.Time
	BlobType() Type
}

// ReplacementBlob is a common interface for blobs for snapshot-style record,
// where new blobs replace previous blobs in full.
// These replacement blobs should return the TSID of the entity they replace.
type ReplacementBlob interface {
	Blob
	TSID() TSID
}

// BaseBlob is the base struct for all blobs.
type BaseBlob struct {
	Type   Type           `refmt:"type"`
	Signer core.Principal `refmt:"signer"`
	Sig    core.Signature `refmt:"sig"`
	Ts     time.Time      `refmt:"ts"`
}

// BlobTime implements the Blob interface.
func (b BaseBlob) BlobTime() time.Time {
	return b.Ts
}

// BlobType implements the Blob interface.
func (b BaseBlob) BlobType() Type {
	return b.Type
}

// Sign the blob and fill in the signature.
// The pointer sig is supposed to be a field of v.
func Sign(kp *core.KeyPair, v any, sig *core.Signature) error {
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

// Verify checks the signature of a blob.
func Verify(pubkey core.Principal, v any, sig core.Signature) error {
	signer, err := pubkey.Parse()
	if err != nil {
		return err
	}

	if len(sig) != signer.SignatureSize() {
		return errors.New("signature size mismatch")
	}

	sigCopy := make([]byte, len(sig))
	for i, b := range sig {
		sigCopy[i] = b
		sig[i] = 0
	}

	unsignedBytes, err := cbornode.DumpObject(v)
	if err != nil {
		return err
	}

	if err := signer.Verify(unsignedBytes, sigCopy); err != nil {
		return err
	}

	copy(sig, sigCopy)

	return nil
}

// Encoded is a type for a type-safe decoded with with its raw encoded data and CID.
type Encoded[T any] struct {
	CID     cid.Cid
	Data    []byte
	Decoded T
}

// TSID derives a TSID from the encoded blob.
func (eb Encoded[T]) TSID() TSID {
	switch blob := any(eb.Decoded).(type) {
	case ReplacementBlob:
		tsid := blob.TSID()
		if tsid != "" {
			return tsid
		}

		return NewTSID(blob.BlobTime(), eb.Data)
	case Blob:
		return NewTSID(blob.BlobTime(), eb.Data)
	default:
		panic(fmt.Errorf("BUG: type %T doesn't implement Blob interface", eb.Decoded))
	}
}

func encodeBlob[T any](v T) (eb Encoded[T], err error) {
	data, err := cbornode.DumpObject(v)
	if err != nil {
		return eb, err
	}

	blk := ipfs.NewBlock(uint64(multicodec.DagCbor), data)

	return Encoded[T]{CID: blk.Cid(), Data: blk.RawData(), Decoded: v}, nil
}

// RawData implements blocks.Block interface.
func (eb Encoded[T]) RawData() []byte {
	return eb.Data
}

// Cid implements blocks.Block interface.
func (eb Encoded[T]) Cid() cid.Cid {
	return eb.CID
}

// String implements blocks.Block interface.
func (eb Encoded[T]) String() string {
	return fmt.Sprintf("[EncodedBlob %s]", eb.CID)
}

// Loggable implements blocks.Block interface.
func (eb Encoded[T]) Loggable() map[string]interface{} {
	return map[string]interface{}{
		"cid": eb.CID,
	}
}

// WithCID is a type for a decoded blob with its CID.
// Because blobs are content-addressed, they don't contain their own ID,
// so when you decode them, you somehow need to separately carry their IDs if you need to.
// This type provides a unified way of doing this.
type WithCID[T any] struct {
	CID   cid.Cid
	Value T
}

func mapstruct(from, to any) error {
	cfg := &mapstructure.DecoderConfig{
		Metadata:  nil,
		Result:    to,
		MatchName: func(a, b string) bool { return a == b },
	}

	dec, err := mapstructure.NewDecoder(cfg)
	if err != nil {
		return err
	}

	return dec.Decode(from)
}

package blob

import (
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

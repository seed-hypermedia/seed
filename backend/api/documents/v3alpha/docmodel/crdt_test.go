package docmodel

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

// decodeOpID is fed by the refs carried in changes that arrive from the network,
// so out-of-range values must produce an error rather than silently truncating
// into the opID struct (the index used to be cast through int32).
func TestDecodeOpID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   []uint64
		want opID
		err  string
	}{
		{
			name: "empty is the zero op ID",
			in:   nil,
			want: opID{},
		},
		{
			name: "self reference",
			in:   []uint64{42},
			want: opID{Ts: 0, Idx: 42, Actor: math.MaxUint64},
		},
		{
			name: "self reference at the index limit",
			in:   []uint64{maxIdx},
			want: opID{Ts: 0, Idx: maxIdx, Actor: math.MaxUint64},
		},
		{
			name: "self reference above the index limit",
			in:   []uint64{maxIdx + 1},
			err:  "index 2147483648 overflows",
		},
		{
			name: "full op ID",
			in:   []uint64{1234, 56, 78},
			want: opID{Ts: 1234, Idx: 56, Actor: 78},
		},
		{
			name: "index above the limit",
			in:   []uint64{1234, maxIdx + 1, 78},
			err:  "index 2147483648 overflows",
		},
		{
			name: "timestamp above the limit",
			in:   []uint64{maxTs + 1, 56, 78},
			err:  "timestamp 281474976710656 overflows",
		},
		{
			// Without the bounds check this decodes to a negative timestamp,
			// which sorts before every real op in opID.Compare.
			name: "timestamp that would decode as negative",
			in:   []uint64{math.MaxUint64, 56, 78},
			err:  "timestamp 18446744073709551615 overflows",
		},
		{
			name: "wrong length",
			in:   []uint64{1, 2},
			err:  "invalid opID",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := decodeOpID(tt.in)
			if tt.err != "" {
				require.ErrorContains(t, err, tt.err)
				require.Equal(t, opID{}, got, "failed decoding must not return a partial op ID")
				return
			}

			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestEncodeDecodeOpIDRoundTrip(t *testing.T) {
	t.Parallel()

	for _, want := range []opID{
		{},
		{Ts: 0, Idx: 42, Actor: math.MaxUint64},
		{Ts: 1234, Idx: 56, Actor: 78},
		{Ts: maxTs - 1, Idx: maxIdx, Actor: 78},
	} {
		got, err := decodeOpID(encodeOpID(want))
		require.NoError(t, err)
		require.Equal(t, want, got)
	}
}

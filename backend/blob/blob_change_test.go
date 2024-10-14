package blob

import (
	"testing"
)

func TestEncodeOpID(t *testing.T) {
	tests := []struct {
		name string
		op   OpID
	}{
		{
			name: "Zero values",
			op:   OpID{Ts: 0, Idx: 0, Origin: 0},
		},
		{
			name: "Maximum values",
			op:   OpID{Ts: maxTimestamp, Idx: maxIdx, Origin: maxOrigin},
		},
		{
			name: "Random values",
			op:   OpID{Ts: 1234567890, Idx: 9876, Origin: 987654321},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded := tt.op.Encode()
			decoded := encoded.Decode()

			if decoded != tt.op {
				t.Errorf("Round-trip failed. Got %+v, want %+v", decoded, tt.op)
			}
		})
	}
}

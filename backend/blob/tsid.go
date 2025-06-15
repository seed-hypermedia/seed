package blob

import (
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/multiformats/go-multibase"
)

const maxTS = 1<<48 - 1

// TSID is a unique identifier of a replaceable resource,
// within a namespace of a public key.
// The ID has an embedded timestamp, hence the name.
type TSID string

// Timestamp extracts the timestamp from the TSID.
// If the TSID is malformed this method may panic.
func (o TSID) Timestamp() time.Time {
	b, err := o.Bytes()
	if err != nil {
		panic(err)
	}
	ms := decodeTime(b[:6])
	return time.UnixMilli(ms)
}

// Parse extract the timestamp and the hash from the TSID.
func (o TSID) Parse() (ts time.Time, hash [4]byte, err error) {
	b, err := o.Bytes()
	if err != nil {
		return ts, hash, err
	}
	ms := decodeTime(b[:6])
	ts = time.UnixMilli(ms)
	copy(hash[:], b[6:10])
	return ts, hash, nil
}

// Bytes returns the byte representation of the TSID.
func (o TSID) Bytes() (out [10]byte, err error) {
	_, b, err := multibase.Decode(string(o))
	if err != nil {
		return out, err
	}

	if len(b) != 10 {
		return out, fmt.Errorf("BUG: TSID byte representation must be 10 bytes long")
	}

	copy(out[:], b)
	return out, nil
}

// String implements fmt.Stringer.
func (o TSID) String() string {
	return string(o)
}

// NewTSIDWithHash creates a new TSID from a timestamp and a truncated hash digest.
func NewTSIDWithHash(ts time.Time, hash [4]byte) TSID {
	if !ts.Equal(ts.Round(ClockPrecision)) {
		panic("BUG: timestamp must be rounded to clock precision")
	}

	ms := ts.UnixMilli()
	if ms >= maxTS {
		panic("BUG: timestamp exceeds maximum allowed of 48 bits")
	}

	b := make([]byte, 10) // 6 bytes for timestamp, 4 bytes for hash.
	encodeTime(b, ms)
	copy(b[6:], hash[:])

	s, err := multibase.Encode(multibase.Base58BTC, b)
	if err != nil {
		panic(err)
	}

	return TSID(s)
}

// NewTSID creates a new TSID from a timestamp and data.
func NewTSID(ts time.Time, data []byte) TSID {
	if len(data) == 0 {
		panic("BUG: data cannot be empty")
	}

	var hash [4]byte
	sum := sha256.Sum256(data)
	copy(hash[:], sum[:])

	return NewTSIDWithHash(ts, hash)
}

func encodeTime(id []byte, ms int64) {
	_ = id[5] // bounds check hint to compiler; see golang.org/issue/14808
	id[0] = byte(ms >> 40)
	id[1] = byte(ms >> 32)
	id[2] = byte(ms >> 24)
	id[3] = byte(ms >> 16)
	id[4] = byte(ms >> 8)
	id[5] = byte(ms)
}

func decodeTime(id []byte) int64 {
	_ = id[5] // bounds check hint to compiler; see golang.org/issue/14808
	return int64(id[0])<<40 |
		int64(id[1])<<32 |
		int64(id[2])<<24 |
		int64(id[3])<<16 |
		int64(id[4])<<8 |
		int64(id[5])
}

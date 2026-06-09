package rbsr

import (
	"crypto/sha256"
	"encoding/binary"
	"unsafe"
)

// Fingerprint is the RBSR fingerprint.
type Fingerprint [fingerprintSize]byte

type accumulator struct {
	len int
	sum [32]byte
}

func (acc *accumulator) Add(other [32]byte) {
	addSum(&acc.sum, other)
}

// addSum adds other into sum as a 256-bit little-endian unsigned integer with
// wraparound (mod 2^256). The operation is associative and commutative with a
// zero identity, which is exactly what lets the per-subtree sums of a monoid
// tree be combined in any order — see [treeStore]. Factored out of
// [accumulator.Add] so both the linear fold and the tree share one carry impl.
func addSum(sum *[32]byte, other [32]byte) {
	var currCarry, nextCarry uint64

	// Treating [32]byte as [4]uint64 when adding.
	p := (*[4]uint64)(unsafe.Pointer(&sum[0]))
	po := (*[4]uint64)(unsafe.Pointer(&other[0]))

	for i := range 4 {
		orig := p[i]
		otherV := po[i]

		next := orig

		next += currCarry
		if next < orig {
			nextCarry = 1
		}

		next += otherV
		if next < otherV {
			nextCarry = 1
		}

		p[i] = next

		currCarry = nextCarry
		nextCarry = 0
	}
}

func (acc *accumulator) Fingerprint() Fingerprint {
	buf := make([]byte, 0, len(acc.sum)+8) // sum + len will be hashed.
	buf = append(buf, acc.sum[:]...)
	buf = binary.LittleEndian.AppendUint64(buf, uint64(acc.len)) //nolint:gosec

	hash := sha256.Sum256(buf)

	var fingerprint Fingerprint
	copy(fingerprint[:], hash[:fingerprintSize])
	return fingerprint
}

package lseq

import (
	"cmp"
	"math"
)

type Position []Segment

func (p Position) Cmp(o Position) int {
	al := len(p)
	bl := len(o)
	ml := min(al, bl)

	for i := range ml {
		if p[i].Less(o[i]) {
			return -1
		}
		if p[i].Greater(o[i]) {
			return +1
		}
	}

	if al == bl {
		return 0
	}

	return cmp.Compare(al, bl)
}

// origin + seq.
// origin will be 32 bits
type Segment [2]uint64

func (ps Segment) Origin() uint64 {
	return ps[0]
}

func (ps Segment) Seq() uint64 {
	return ps[1]
}

func (ps Segment) Less(other Segment) bool {
	ocmp := cmp.Compare(ps.Origin(), other.Origin())
	if ocmp == 0 {
		return ps.Seq() < other.Seq()
	}
	return ocmp < 0
}

func (ps Segment) Greater(other Segment) bool {
	ocmp := cmp.Compare(ps.Origin(), other.Origin())
	if ocmp == 0 {
		return ps.Seq() > other.Seq()
	}
	return ocmp > 0
}

var maxSegment = Segment{math.MaxUint64, math.MaxUint64}

func newPos(origin uint64, left, right Position) Position {
	min := Position{{origin, 0}}

	lo := left
	if lo == nil {
		lo = min
	}

	hi := right
	if hi == nil {
		hi = Position{maxSegment}
	}

	var (
		sequence Position
		i        int
		diffed   bool
	)
	for i < len(lo) && i < len(hi) {
		l := lo[i]
		r := hi[i]
		n := Segment{l.Origin(), l.Seq() + 1}

		if r.Greater(n) {
			if n.Origin() != origin {
				sequence = append(sequence, l)
			} else {
				sequence = append(sequence, n)
				diffed = true
				break
			}
		} else {
			sequence = append(sequence, l)
		}
		i++
	}

	minSeg := Segment{origin, 0}
	for !diffed {
		l := minSeg
		if i < len(lo) {
			l = lo[i]
		}

		r := maxSegment
		if i < len(hi) {
			r = hi[i]
		}

		n := Segment{origin, l.Seq() + 1}
		if r.Greater(n) {
			sequence = append(sequence, n)
			diffed = true
		} else {
			sequence = append(sequence, l)
		}
		i++
	}

	return sequence
}

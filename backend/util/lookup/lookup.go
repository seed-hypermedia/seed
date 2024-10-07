// Package lookup provides a simple utility for building lookup tables,
// useful when encoding repeated values in a file.
package lookup

import (
	"maps"
	"slices"
	"strconv"
)

// Table is a sorted list of unique values.
// Elsewhere, there should be a Pointer, which is an index into this list.
// Table must be constructed using a [Builder].
type Table[T any] []T

// Get value from the table given a pointer.
func (lt Table[T]) Get(i *Pointer) T {
	return lt[*i]
}

// Pointer is an index into the lookup table.
type Pointer int

func (lp *Pointer) String() string {
	return strconv.Itoa(int(*lp))
}

// Builder for the lookup table.
type Builder[T comparable] struct {
	dict map[T]*Pointer
}

// Add value into the table and return its pointer.
// If the value already exists, return the existing pointer.
func (ltb *Builder[T]) Add(v T) *Pointer {
	if ltb.dict == nil {
		ltb.dict = make(map[T]*Pointer)
	}

	lp, ok := ltb.dict[v]
	if ok {
		return lp
	}

	idx := Pointer(len(ltb.dict))
	lp = &idx
	ltb.dict[v] = lp
	return lp
}

// Build the table by sorting the values and updating the pointers
// with the final indices into the resulting table.
func (ltb *Builder[T]) Build(cmp func(T, T) int) Table[T] {
	out := slices.Collect(maps.Keys(ltb.dict))
	slices.SortFunc(out, cmp)
	for i, v := range out {
		ptr := ltb.dict[v]
		*ptr = Pointer(i)
	}
	return out
}

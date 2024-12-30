package colx

import (
	"fmt"
	"slices"
)

type Slice[T any] []T

// Append is a convenience method to append an element to the slice
// without the need to reassign the returned variable with the built-in append function.
func (s *Slice[T]) Append(v ...T) {
	*s = append(*s, v...)
}

// WrapSlice wraps a standard slice into a Slice,
// which exposes various convenience methods for slice operations.
func WrapSlice[S ~[]E, E any](in S) Slice[E] {
	return Slice[E](in)
}

// Sort the slice in places using the provided comparison function,
// and returns the sorted result to allow chaining.
func (s Slice[T]) Sort(cmp func(T, T) int) Slice[T] {
	slices.SortFunc(s, cmp)
	return s
}

// GetMaybe returns the element at the given index,
// or a zero value if the index is out of bounds.
func (s Slice[T]) GetMaybe(i int) T {
	if i < 0 || i >= len(s) {
		return *new(T)
	}
	return s[i]
}

// SliceMap applies a map function to each element of the slice
// and produces a new slice with (possibly) transformed value.
func SliceMap[In any, Out any](in []In, fn func(In) Out) []Out {
	out := make([]Out, len(in))
	for i, v := range in {
		out[i] = fn(v)
	}
	return out
}

// SliceMapErr applies a map function that might return an error.
func SliceMapErr[In any, Out any](in []In, fn func(In) (Out, error)) ([]Out, error) {
	out := make([]Out, len(in))
	for i, v := range in {
		var err error
		out[i], err = fn(v)
		if err != nil {
			return nil, fmt.Errorf("failed to map element %v to type %T: %w", v, *(new(Out)), err)
		}
	}
	return out, nil
}

// SliceDeleteAppend deletes an element shifting the tail using append.
func SliceDeleteAppend[T any](s []T, i int) []T {
	return append(s[:i], s[i+1:]...)
}

// SliceDeleteCopy deletes an element shifting the tail using copy.
func SliceDeleteCopy[T any](s []T, i int) []T {
	return s[:i+copy(s[i:], s[i+1:])]
}

// SliceDeleteUnordered deletes an element without preserving order.
func SliceDeleteUnordered[T any](s []T, i int) []T {
	s[i] = s[len(s)-1]
	return s[:len(s)-1]
}

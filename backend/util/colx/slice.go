package colx

import (
	"cmp"
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

// SlicePermutations generates all permutations of a given slice.
// It uses Heap's algorithm and is generic, working with slices of any type.
func SlicePermutations[T any](input []T) [][]T {
	// Clone the input slice to avoid modifying the original data.
	data := make([]T, len(input))
	copy(data, input)

	var result [][]T

	// The recursive helper function that generates permutations.
	// k is the size of the sub-array to be permuted.
	var generate func(k int, arr []T)
	generate = func(k int, arr []T) {
		if k == 1 {
			// Base case: a single element is a permutation of itself.
			// We must copy the slice, otherwise we'd just have a slice of
			// pointers to the same underlying array, which would all be
			// the same by the end of the process.
			permutation := make([]T, len(arr))
			copy(permutation, arr)
			result = append(result, permutation)
			return
		}

		// Generate permutations for k-1 elements.
		generate(k-1, arr)

		// Generate permutations for the kth element.
		for i := 0; i < k-1; i++ {
			// Swap logic depends on whether k is even or odd.
			if k%2 == 0 {
				// If k is even, swap element i with the last element.
				arr[i], arr[k-1] = arr[k-1], arr[i]
			} else {
				// If k is odd, swap the first element with the last element.
				arr[0], arr[k-1] = arr[k-1], arr[0]
			}
			// Recursively generate permutations for the smaller set.
			generate(k-1, arr)
		}
	}

	generate(len(data), data)
	return result
}

// CommonPrefix returns the number os elements that are equal in both slices.
func CommonPrefix[E cmp.Ordered, S ~[]E](a, b S) int {
	n := min(len(a), len(b))
	var i int
	for i < n && a[i] == b[i] {
		i++
	}
	return i
}

// HasPrefix returns whether s has the given prefix.
func HasPrefix[E cmp.Ordered, S ~[]E](s, prefix S) bool {
	return len(s) >= len(prefix) && slices.Equal(s[0:len(prefix)], prefix)
}

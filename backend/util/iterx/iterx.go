// Package iterx provides some utilities to work with iterators.
package iterx

import "iter"

// Enumerate takes a sequence iterator and returns a new iterator
// that yields the index along with the value.
// This is similar to ranging over a slice in Go.
func Enumerate[T any](in iter.Seq[T]) iter.Seq2[int, T] {
	return func(yield func(int, T) bool) {
		var i int
		for v := range in {
			if !yield(i, v) {
				break
			}
			i++
		}
	}
}

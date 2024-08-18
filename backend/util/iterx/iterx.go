// Package iterx provides extra utilities for working with iterators.
package iterx

import (
	"errors"
	"iter"
)

// NopSeq returns iter.Seq that doesn't panic when ranged over it.
// By default ranging over nil iterators panics.
func NopSeq[T any]() iter.Seq[T] {
	return func(func(T) bool) {}
}

// NopSeq2 is the same as NopSeq but for iter.Seq2.
func NopSeq2[K, V any]() iter.Seq2[K, V] {
	return func(func(K, V) bool) {}
}

// LazyError can be used to accumulate errors to be checked after the iteration.
// See the tests for an example of how to use it.
type LazyError struct {
	err error
}

// NewLazyError returns a new LazyError.
func NewLazyError() *LazyError {
	return &LazyError{}
}

// Set the error value.
// Panics if called more than once with non-nil error.
func (le *LazyError) Set(err error) {
	if err == nil {
		return
	}

	if le.err != nil {
		panic("BUG: LazyError.Set called twice")
	}

	le.err = err
}

// Add error to the undelying error value.
func (le *LazyError) Add(err error) {
	le.err = errors.Join(le.err, err)
}

// Check returns the accumulated error.
func (le *LazyError) Check() error {
	return le.err
}

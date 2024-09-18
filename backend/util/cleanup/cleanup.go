// Package cleanup provides a cleanup stack that can be used to group multiple io.Closer's.
package cleanup

import (
	"context"
	"errors"
	"io"
)

type errFuncCloser func() error

func (f errFuncCloser) Close() error {
	return f()
}

// Stack of closers to clean up. Use Close() to close them
// in the LIFO order. Zero value is useful.
type Stack struct {
	done  bool
	err   error
	funcs []io.Closer

	// IgnoreContextCanceled can be used to ignore context.Canceled errors
	// during the shutdown process.
	IgnoreContextCanceled bool
}

// Add closer to the cleanup stack.
func (s *Stack) Add(c ...io.Closer) {
	s.funcs = append(s.funcs, c...)
}

// AddErrFunc to the cleanup stack.
func (s *Stack) AddErrFunc(fn ...func() error) {
	for _, f := range fn {
		s.funcs = append(s.funcs, errFuncCloser(f))
	}
}

// Close the stack in the LIFO order. It will only execute once and will remember the error.
// Not safe for concurrent use.
func (s *Stack) Close() error {
	if s.done {
		return s.err
	}

	if len(s.funcs) == 0 {
		return s.err
	}

	// We have to close in reverse order because some later dependencies
	// can use previous ones. This is similar to defer statement.
	for i := len(s.funcs) - 1; i >= 0; i-- {
		err := s.funcs[i].Close()
		if errors.Is(err, context.Canceled) && s.IgnoreContextCanceled {
			continue
		}
		s.err = errors.Join(s.err, err)
	}

	s.done = true
	return s.err
}

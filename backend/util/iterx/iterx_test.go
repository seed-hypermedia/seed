package iterx_test

import (
	"bufio"
	"errors"
	"io"
	"iter"
	"seed/backend/util/iterx"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLazyError(t *testing.T) {
	want := []string{"hello", "world", "foo", "bar"}
	var got []string

	lines, errs := scan()
	for line := range lines {
		got = append(got, line)
	}
	require.True(t, errors.Is(errs.Check(), io.ErrUnexpectedEOF))

	require.Equal(t, want, got)
}

// scan returns an iterator that wraps bufio.Scanner, showcasing how to use LazyError.
func scan() (iter.Seq[string], *iterx.LazyError) {
	le := iterx.NewLazyError()

	it := func(yield func(string) bool) {
		r := io.MultiReader(strings.NewReader("hello\nworld\nfoo\nbar\n"), &failingReader{})
		scanner := bufio.NewScanner(r)

		for scanner.Scan() {
			if !yield(scanner.Text()) {
				break
			}
		}

		le.Add(scanner.Err())
	}

	return it, le
}

type failingReader struct{}

func (f *failingReader) Read(p []byte) (n int, err error) {
	return 0, io.ErrUnexpectedEOF
}

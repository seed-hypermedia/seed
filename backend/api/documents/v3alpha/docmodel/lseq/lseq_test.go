package lseq

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLSEQ(t *testing.T) {
	a := New[byte]()
	b := New[byte]()
	alice := uint64(10)
	bob := uint64(20)
	_ = bob

	a.InsertAt(0, alice, 'H', ' ', '!')
	a.InsertAt(1, alice, 'i')

	merge(b, a)

	a.InsertAt(3, alice, 'M', 'o', 'm')
	b.InsertAt(3, bob, 'D', 'a', 'd')

	merge(b, a)
	merge(a, b)

	require.Equal(t, slices.Collect(a.Values()), slices.Collect(b.Values()))
	require.Equal(t, "Hi MomDad!", string(slices.Collect(a.Values())))

	a.InsertAt(a.items.Len(), alice, 'H', 'e', 'y')

	require.True(t, slices.IsSortedFunc(a.keys(), Position.Cmp))

	want := []Position{
		{{10, 1}},
		{{10, 1}, {10, 1}},
		{{10, 2}},
		{{10, 2}, {10, 1}},
		{{10, 2}, {10, 2}},
		{{10, 2}, {10, 3}},
		{{10, 2}, {20, 1}},
		{{10, 2}, {20, 2}},
		{{10, 2}, {20, 3}},
		{{10, 3}},
		{{10, 4}},
		{{10, 5}},
		{{10, 6}},
	}
	require.Equal(t, want, a.keys())
}

func merge[T any](dst, src *LSEQ[T]) {
	for i := range src.items.Len() {
		item, ok := src.items.GetAt(i)
		if !ok {
			continue
		}
		dst.items.SetHint(item, &dst.hint)
	}
}

func (l *LSEQ[T]) keys() []Position {
	out := make([]Position, l.items.Len())
	for i := range l.items.Len() {
		item, ok := l.items.GetAt(i)
		if !ok {
			continue
		}
		out[i] = item.pos
	}
	return out
}

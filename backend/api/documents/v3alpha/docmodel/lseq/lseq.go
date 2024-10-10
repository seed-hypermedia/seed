// Package lseq provides a list CRDT with absolute position for elements.
// It's similar to the original LSEQ algorithm, but doesn't cause interleaving of elements.
// In fact, it's more similar to the RGA algorithm, but it generates absolute positions which can be compared lexicographically.
// See this article for more information: https://www.bartoszsypytkowski.com/non-interleaving-lseq.
package lseq

import (
	"iter"

	"github.com/tidwall/btree"
)

// Item of an LSEQ list.
type Item[T any] struct {
	pos   Position
	value T
}

// LSEQ is a list CRDT with absolute positions.
type LSEQ[T any] struct {
	items *btree.BTreeG[Item[T]]
	hint  btree.PathHint
}

// New creates a new LSEQ list.
func New[T any]() *LSEQ[T] {
	return &LSEQ[T]{
		items: btree.NewBTreeGOptions(
			func(a, b Item[T]) bool {
				return a.pos.Cmp(b.pos) < 0
			},
			btree.Options{
				NoLocks: true,
				Degree:  8,
			},
		),
	}
}

func (l *LSEQ[T]) maybePosAt(idx int) Position {
	if idx < 0 || l.items.Len() == 0 || idx >= l.items.Len() {
		return nil
	}

	el, _ := l.items.GetAt(idx)
	return el.pos
}

// InsertAt inserts values at the specified index.
func (l *LSEQ[T]) InsertAt(idx int, origin uint64, values ...T) []Position {
	if idx < 0 || idx > l.items.Len() {
		panic("index out of bounds")
	}

	left := l.maybePosAt(idx - 1)
	right := l.maybePosAt(idx)

	out := make([]Position, len(values))

	for i, value := range values {
		pos := newPos(origin, left, right)
		item := Item[T]{pos: pos, value: value}
		l.items.SetHint(item, &l.hint)
		left = pos
		out[i] = pos
	}

	return out
}

// Values returns an in-order iterator for values.
func (l *LSEQ[T]) Values() iter.Seq[T] {
	return func(yield func(T) bool) {
		for i := range l.items.Len() {
			it, ok := l.items.GetAt(i)
			if !ok {
				panic("BUG: items not found during iteration")
			}

			if !yield(it.value) {
				return
			}
		}
	}
}

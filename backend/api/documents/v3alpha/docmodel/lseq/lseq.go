package lseq

import (
	"iter"

	"github.com/tidwall/btree"
)

type Item[T any] struct {
	pos   Position
	value T
}

type LSEQ[T any] struct {
	items *btree.BTreeG[Item[T]]
	hint  btree.PathHint
}

func NewLSEQ[T any]() *LSEQ[T] {
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

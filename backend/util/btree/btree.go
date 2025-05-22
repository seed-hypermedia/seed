// Package btree provides a B-Tree map wrapper for an existing library, exposing a simpler and more convenient API.
package btree

import (
	"iter"

	"github.com/tidwall/btree"
)

// Map is a B-Tree map data structure.
type Map[K, V any] struct {
	hint btree.PathHint
	tr   *btree.BTreeG[Node[K, V]]
	cmp  func(K, K) int
}

// Node is a key-value pair in the B-Tree.
type Node[K, V any] struct {
	K K
	V V
}

func newNode[K, V any](k K, v V) Node[K, V] {
	return Node[K, V]{K: k, V: v}
}

// New creates a new B-Tree map.
func New[K, V any](degree int, cmp func(K, K) int) *Map[K, V] {
	tr := btree.NewBTreeGOptions(
		func(a, b Node[K, V]) bool {
			return cmp(a.K, b.K) < 0
		},
		btree.Options{
			NoLocks: true,
			Degree:  degree,
		},
	)

	return &Map[K, V]{
		tr:  tr,
		cmp: cmp,
	}
}

// Set key k to value v.
func (b *Map[K, V]) Set(k K, v V) (replaced bool) {
	_, replaced = b.tr.SetHint(newNode(k, v), &b.hint)
	return replaced
}

// Delete key k to value v.
func (b *Map[K, V]) Delete(k K) (deleted bool) {
	_, deleted = b.tr.DeleteHint(newNode(k, *new(V)), &b.hint)
	return deleted
}

// Swap is like Set but returns the previous value if any.
func (b *Map[K, V]) Swap(k K, v V) (prev V, replaced bool) {
	oldNode, replaced := b.tr.SetHint(newNode(k, v), &b.hint)
	return oldNode.V, replaced
}

// GetMaybe returns the value at k, or a zero value if k is not set.
// Use Get if you want to distinguish between the zero value and the key not existing.
func (b *Map[K, V]) GetMaybe(k K) (v V) {
	b.tr.AscendHint(Node[K, V]{K: k}, func(item Node[K, V]) bool {
		if b.cmp(item.K, k) == 0 {
			v = item.V
		}
		return false
	}, &b.hint)

	return v
}

// Get the value by key k.
func (b *Map[K, V]) Get(k K) (v V, ok bool) {
	b.tr.AscendHint(Node[K, V]{K: k}, func(item Node[K, V]) bool {
		if b.cmp(item.K, k) == 0 {
			v = item.V
			ok = true
		}
		return false
	}, &b.hint)

	return v, ok
}

// GetNode returns the node by key k.
func (b *Map[K, V]) GetNode(k K) (n Node[K, V], ok bool) {
	b.tr.AscendHint(Node[K, V]{K: k}, func(item Node[K, V]) bool {
		if b.cmp(item.K, k) == 0 {
			n = item
			ok = true
		}
		return false
	}, &b.hint)

	return n, ok
}

// GetAtMaybe is like GetAt, but returns the zero value if key is not set.
func (b *Map[K, V]) GetAtMaybe(idx int) (k K, v V) {
	n, _ := b.tr.GetAt(idx)
	return n.K, n.V
}

// GetAt returns the key-value pair at index idx.
func (b *Map[K, V]) GetAt(idx int) (k K, v V, ok bool) {
	n, ok := b.tr.GetAt(idx)
	return n.K, n.V, ok
}

// Len returns the number of elements in the B-Tree.
func (b *Map[K, V]) Len() int {
	if b == nil {
		return 0
	}
	return b.tr.Len()
}

// Items returns an iterator for map key-value items.
func (b *Map[K, V]) Items() iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.AscendHint(Node[K, V]{}, func(item Node[K, V]) bool {
			return yield(item.K, item.V)
		}, &b.hint)
	}
}

// Seek returns an iterator for records starting from the key that is >= than k.
func (b *Map[K, V]) Seek(k K) iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.AscendHint(Node[K, V]{K: k}, func(item Node[K, V]) bool {
			return yield(item.K, item.V)
		}, &b.hint)
	}
}

// SeekReverse is like Seek, but in reverse order.
func (b *Map[K, V]) SeekReverse(k K) iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.DescendHint(Node[K, V]{K: k}, func(item Node[K, V]) bool {
			return yield(item.K, item.V)
		}, &b.hint)
	}
}

// Range returns an iterator for records within the range of [start, end).
func (b *Map[K, V]) Range(start, end K) iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.AscendHint(Node[K, V]{K: start}, func(item Node[K, V]) bool {
			if b.cmp(item.K, end) > 0 {
				return false
			}
			return yield(item.K, item.V)
		}, &b.hint)
	}
}

// Keys returns a slice of keys in the B-Tree in order.
func (b *Map[K, V]) Keys() iter.Seq[K] {
	return func(yield func(K) bool) {
		if b == nil {
			return
		}

		for k := range b.Items() {
			if !yield(k) {
				break
			}
		}
	}
}

// Clear all elements in the map.
func (b *Map[K, V]) Clear() {
	b.tr.Clear()
}

// Copy performs an efficient structural copying of the map.
func (b *Map[K, V]) Copy() *Map[K, V] {
	return &Map[K, V]{
		tr:  b.tr.Copy(),
		cmp: b.cmp,
	}
}

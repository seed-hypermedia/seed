// Package btree provides a B-Tree map wrapper for an existing library, exposing a simpler and more convenient API.
package btree

import (
	"iter"

	"github.com/tidwall/btree"
)

// Map is a B-Tree map data structure.
type Map[K, V any] struct {
	hint btree.PathHint
	tr   *btree.BTreeG[node[K, V]]
	cmp  func(K, K) int
}

type node[K, V any] struct {
	k K
	v V
}

func newNode[K, V any](k K, v V) node[K, V] {
	return node[K, V]{k: k, v: v}
}

// New creates a new B-Tree map.
func New[K, V any](degree int, cmp func(K, K) int) *Map[K, V] {
	tr := btree.NewBTreeGOptions(
		func(a, b node[K, V]) bool {
			return cmp(a.k, b.k) < 0
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

// Swap is like Set but returns the previous value if any.
func (b *Map[K, V]) Swap(k K, v V) (prev V, replaced bool) {
	oldNode, replaced := b.tr.SetHint(newNode(k, v), &b.hint)
	return oldNode.v, replaced
}

// GetMaybe returns the value at k, or a zero value if k is not set.
// Use Get if you want to distinguish between the zero value and the key not existing.
func (b *Map[K, V]) GetMaybe(k K) (v V) {
	b.tr.AscendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
		if b.cmp(item.k, k) == 0 {
			v = item.v
		}
		return false
	}, &b.hint)

	return v
}

// Get the value by key k.
func (b *Map[K, V]) Get(k K) (v V, ok bool) {
	b.tr.AscendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
		if b.cmp(item.k, k) == 0 {
			v = item.v
			ok = true
		}
		return false
	}, &b.hint)

	return v, ok
}

// GetAtMaybe is like GetAt, but returns the zero value if key is not set.
func (b *Map[K, V]) GetAtMaybe(idx int) (k K, v V) {
	n, _ := b.tr.GetAt(idx)
	return n.k, n.v
}

// GetAt returns the key-value pair at index idx.
func (b *Map[K, V]) GetAt(idx int) (k K, v V, ok bool) {
	n, ok := b.tr.GetAt(idx)
	return n.k, n.v, ok
}

// Len returns the number of elements in the B-Tree.
func (b *Map[K, V]) Len() int {
	return b.tr.Len()
}

// Items returns an iterator for map key-value items.
func (b *Map[K, V]) Items() iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.AscendHint(node[K, V]{}, func(item node[K, V]) bool {
			return yield(item.k, item.v)
		}, &b.hint)
	}
}

// Seek returns an iterator for records starting from the given key (inclusive).
func (b *Map[K, V]) Seek(k K) iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.AscendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
			return yield(item.k, item.v)
		}, &b.hint)
	}
}

// SeekReverse is like Seek, but in reverse order.
func (b *Map[K, V]) SeekReverse(k K) iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		b.tr.DescendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
			return yield(item.k, item.v)
		}, &b.hint)
	}
}

// Keys returns a slice of keys in the B-Tree in order.
func (b *Map[K, V]) Keys() []K {
	keys := make([]K, 0, b.Len())
	for k := range b.Items() {
		keys = append(keys, k)
	}
	return keys
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

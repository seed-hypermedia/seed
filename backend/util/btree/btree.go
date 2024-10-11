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

// Get the value by k. If the key does not exist, the zero value of V is returned.
// Use GetOK if you want to distinguish between the zero value and the key not existing.
func (b *Map[K, V]) Get(k K) (v V) {
	b.tr.AscendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
		if b.cmp(item.k, k) == 0 {
			v = item.v
		}
		return false
	}, &b.hint)

	return v
}

// GetOK is like Get but returns an OK flag to distinguish between the zero value and the key not existing.
func (b *Map[K, V]) GetOK(k K) (v V, ok bool) {
	b.tr.AscendHint(node[K, V]{k: k}, func(item node[K, V]) bool {
		if b.cmp(item.k, k) == 0 {
			v = item.v
			ok = true
		}
		return false
	}, &b.hint)

	return v, ok
}

// GetAt is a list-like API to get the key and value at the given index.
// Returns zero-value if the index is out of bounds.
// Use GetAtOK if you want to distinguish between the zero value and the index being.
func (b *Map[K, V]) GetAt(idx int) (k K, v V) {
	n, _ := b.tr.GetAt(idx)
	return n.k, n.v
}

// GetAtOK is like Get but returns an OK flag to distinguish between the zero value and the index being out of bounds.
func (b *Map[K, V]) GetAtOK(idx int) (k K, v V, ok bool) {
	n, ok := b.tr.GetAt(idx)
	return n.k, n.v, ok
}

// Len returns the number of elements in the B-Tree.
func (b *Map[K, V]) Len() int {
	return b.tr.Len()
}

// Iter returns an iterator for records.
func (b *Map[K, V]) Iter() iter.Seq2[K, V] {
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

// Keys returns a slice of keys in the B-Tree in order.
func (b *Map[K, V]) Keys() []K {
	keys := make([]K, 0, b.Len())
	for k := range b.Iter() {
		keys = append(keys, k)
	}
	return keys
}

// Clear all elements in the map.
func (b *Map[K, V]) Clear() {
	b.tr.Clear()
}

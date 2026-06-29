package rbsr

import (
	"encoding/binary"
	"errors"
)

// RangeFingerprinter is an optional capability a [Store] may implement to
// return the fingerprint of an index range without folding every item.
//
// [Session.Fingerprint] type-asserts the store against this interface and uses
// RangeFingerprint when available, falling back to the linear fold otherwise.
// The result must be byte-identical to that fold for the same item set, so an
// implementation must reproduce the fingerprint definition exactly: the 256-bit
// wraparound sum of each item's Hash, with the accumulator length left at zero
// (the current fold never sets it — see [accumulator]).
type RangeFingerprinter interface {
	RangeFingerprint(start, end int) (Fingerprint, error)
}

// treeStore implements [Store] backed by an augmented treap: a balanced BST
// keyed by [Item.Compare] order where each node caches its subtree's element
// count (for order-statistics indexing) and the 256-bit wraparound sum of its
// subtree's item hashes (the monoid used for fingerprints). That lets
// RangeFingerprint combine an index range in O(log n) instead of folding every
// item, which is what makes repeated RBSR rounds cheap.
//
// Balancing is deterministic: each node's heap priority is derived from its
// item hash, so the same set always yields the same tree shape regardless of
// insertion order — no RNG, reproducible across peers and test runs.
//
// Unlike [sliceStore], Insert is permitted after Seal: the tree keeps itself
// ordered on every insert, so there is no separate sort step to invalidate.
// This is what allows the index to be maintained incrementally rather than
// rebuilt. Queries still require a prior Seal to mirror the Store contract.
type treeStore struct {
	root   *treeNode
	seen   map[string]struct{}
	sealed bool
}

type treeNode struct {
	item        Item
	left, right *treeNode
	priority    uint64
	size        int
	sum         [32]byte // 256-bit wraparound sum of this subtree's item hashes.
}

// NewTreeStore creates a [Store] backed by a monoid tree. It additionally
// implements [RangeFingerprinter].
func NewTreeStore() Store {
	return &treeStore{
		seen: make(map[string]struct{}),
	}
}

// sizeOf returns the cached subtree size, treating a nil node as empty. It is a
// method (not a free function) so the nil-receiver case reads naturally; Go
// dispatches methods on nil pointers without dereferencing the receiver.
func (n *treeNode) sizeOf() int {
	if n == nil {
		return 0
	}
	return n.size
}

// update recomputes the cached aggregates from the node's children. Must be
// called whenever a node's children change.
func (n *treeNode) update() {
	n.size = 1 + n.left.sizeOf() + n.right.sizeOf()

	var s [32]byte
	if n.left != nil {
		addSum(&s, n.left.sum)
	}
	addSum(&s, n.item.Hash)
	if n.right != nil {
		addSum(&s, n.right.sum)
	}
	n.sum = s
}

func (v *treeStore) Insert(createdAt int64, id []byte) error {
	key := string(id)
	if _, exists := v.seen[key]; exists {
		return nil
	}
	v.seen[key] = struct{}{}

	item := NewItem(createdAt, id)
	node := &treeNode{
		item:     item,
		priority: binary.LittleEndian.Uint64(item.Hash[:8]),
	}
	v.root = treapInsert(v.root, node)
	return nil
}

func treapInsert(root, node *treeNode) *treeNode {
	if root == nil {
		node.update()
		return node
	}

	// Items are deduplicated by value in the caller, so Compare is never 0.
	if node.item.Compare(root.item) < 0 {
		root.left = treapInsert(root.left, node)
		if root.left.priority > root.priority {
			root = rotateRight(root)
		}
	} else {
		root.right = treapInsert(root.right, node)
		if root.right.priority > root.priority {
			root = rotateLeft(root)
		}
	}
	root.update()
	return root
}

func rotateRight(n *treeNode) *treeNode {
	l := n.left
	n.left = l.right
	l.right = n
	n.update()
	l.update()
	return l
}

func rotateLeft(n *treeNode) *treeNode {
	r := n.right
	n.right = r.left
	r.left = n
	n.update()
	r.update()
	return r
}

func (v *treeStore) Seal() error {
	if v.sealed {
		return errors.New("already sealed")
	}
	v.sealed = true
	return nil
}

func (v *treeStore) Size() int {
	if !v.sealed {
		return 0
	}
	return v.root.sizeOf()
}

func (v *treeStore) ForEach(start, end int, fn func(int, Item) bool) error {
	if err := v.checkSealed(); err != nil {
		return err
	}
	if err := v.checkBounds(start, end); err != nil {
		return err
	}
	forEachRange(v.root, 0, start, end, fn)
	return nil
}

// forEachRange visits items whose index falls in [start, end) in ascending
// index order, where base is the index of the leftmost item in n's subtree.
// Returns false once fn asks to stop so callers unwind without further visits.
func forEachRange(n *treeNode, base, start, end int, fn func(int, Item) bool) bool {
	if n == nil || base >= end || base+n.size <= start {
		return true
	}

	if !forEachRange(n.left, base, start, end, fn) {
		return false
	}

	nodeIdx := base + n.left.sizeOf()
	if nodeIdx >= start && nodeIdx < end {
		if !fn(nodeIdx, n.item) {
			return false
		}
	}

	return forEachRange(n.right, nodeIdx+1, start, end, fn)
}

func (v *treeStore) FindLowerBound(startHint int, bound Item) (int, error) {
	if err := v.checkSealed(); err != nil {
		return 0, err
	}
	if err := v.checkBounds(startHint, v.root.sizeOf()); err != nil {
		return 0, err
	}

	// Index of the first item that is >= bound. Because the set is sorted, any
	// item before startHint that is also >= bound is irrelevant: the slice
	// store searches only items[startHint:], so the answer is max(startHint, l).
	l := 0
	for n := v.root; n != nil; {
		if n.item.Compare(bound) < 0 {
			l += n.left.sizeOf() + 1
			n = n.right
		} else {
			n = n.left
		}
	}
	return max(startHint, l), nil
}

// RangeFingerprint implements [RangeFingerprinter]. It combines the cached
// subtree sums covering [start, end) and returns the same fingerprint the
// linear fold in [Session.Fingerprint] would produce — the length stays zero,
// matching the fold which never sets it.
func (v *treeStore) RangeFingerprint(start, end int) (Fingerprint, error) {
	if err := v.checkSealed(); err != nil {
		return Fingerprint{}, err
	}
	if err := v.checkBounds(start, end); err != nil {
		return Fingerprint{}, err
	}

	var acc accumulator
	sumRange(v.root, 0, start, end, &acc)
	return acc.Fingerprint(), nil
}

// sumRange adds the hashes of items whose index falls in [start, end) into acc,
// short-circuiting whole subtrees that are fully contained in the range via
// their cached sum — that shortcut is what keeps the traversal O(log n).
func sumRange(n *treeNode, base, start, end int, acc *accumulator) {
	if n == nil || base >= end || base+n.size <= start {
		return
	}

	if start <= base && base+n.size <= end {
		acc.Add(n.sum)
		return
	}

	sumRange(n.left, base, start, end, acc)
	nodeIdx := base + n.left.sizeOf()
	if nodeIdx >= start && nodeIdx < end {
		acc.Add(n.item.Hash)
	}
	sumRange(n.right, nodeIdx+1, start, end, acc)
}

func (v *treeStore) checkSealed() error {
	if !v.sealed {
		return errors.New("not sealed")
	}
	return nil
}

func (v *treeStore) checkBounds(begin, end int) error {
	if begin > end || end > v.root.sizeOf() {
		return errors.New("bad range")
	}
	return nil
}

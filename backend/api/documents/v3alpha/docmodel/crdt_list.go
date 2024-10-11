package docmodel

import (
	"cmp"
	"fmt"
	"iter"
	"seed/backend/util/btree"

	"roci.dev/fracdex"
)

var errCausalityViolation = fmt.Errorf("causality violation")

type rgaItem[T any] struct {
	ID    opID
	Ref   opID
	Value T
}

type rgaKey struct {
	Fracdex string
	Deleted bool
}

var zeroOpID = opID{}

type rgaList[T any] struct {
	applied *btree.Map[opID, string]       // opID => fracdex
	items   *btree.Map[rgaKey, rgaItem[T]] // fracdex => rgaItem
}

func newRGAList[T any]() *rgaList[T] {
	return &rgaList[T]{
		applied: btree.New[opID, string](8, opID.Compare),
		items: btree.New[rgaKey, rgaItem[T]](8, func(a, b rgaKey) int {
			return cmp.Compare(a.Fracdex, b.Fracdex)
		}),
	}
}

func (l *rgaList[T]) Integrate(id, ref opID, v T) error {
	if _, ok := l.applied.GetOK(id); ok {
		return fmt.Errorf("duplicate op ID in the list")
	}

	var left string
	if ref != zeroOpID {
		refFracdex, ok := l.applied.GetOK(ref)
		if !ok {
			return fmt.Errorf("%w: ref op %v is not found", errCausalityViolation, ref)
		}
		left = refFracdex
	}

	seekItem := rgaKey{Fracdex: left}

	var right string
	for k, v := range l.items.Seek(seekItem) {
		// Seek returns the pivot item first.
		if k == seekItem {
			continue
		}

		// RGA rules: skip over any elements with a greater ID to the right of our desired insertion point.
		if v.ID.Compare(id) > 0 {
			left = k.Fracdex
			continue
		} else {
			right = k.Fracdex
			break
		}
	}

	newPos, err := fracdex.KeyBetween(left, right)
	if err != nil {
		return err
	}

	newItem := rgaItem[T]{ID: id, Ref: ref, Value: v}

	if l.items.Set(rgaKey{Fracdex: newPos}, newItem) {
		panic("BUG: duplicate fracdex")
	}

	if l.applied.Set(id, newPos) {
		panic("BUG: duplicate op ID")
	}

	return nil
}

func (l *rgaList[T]) ValuesAlive() iter.Seq[T] {
	return func(yield func(T) bool) {
		for k, v := range l.items.Iter() {
			if k.Deleted {
				continue
			}

			if !yield(v.Value) {
				break
			}
		}
	}
}

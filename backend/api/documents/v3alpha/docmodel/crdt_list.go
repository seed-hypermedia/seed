package docmodel

import (
	"fmt"
	"iter"
	"seed/backend/util/btree"
	"strings"

	"roci.dev/fracdex"
)

var errCausalityViolation = fmt.Errorf("causality violation")

type rgaItem[T any] struct {
	ID        opID
	Ref       opID
	Value     T
	IsDeleted bool
}

var zeroOpID = opID{}

type rgaList[T any] struct {
	applied *btree.Map[opID, string]       // opID => fracdex
	items   *btree.Map[string, rgaItem[T]] // fracdex => rgaItem
}

func newRGAList[T any]() *rgaList[T] {
	return &rgaList[T]{
		applied: btree.New[opID, string](8, opID.Compare),
		items:   btree.New[string, rgaItem[T]](8, strings.Compare),
	}
}

// Copy returns a structurally-shared copy of the list.
func (l *rgaList[T]) Copy() *rgaList[T] {
	return &rgaList[T]{
		applied: l.applied.Copy(),
		items:   l.items.Copy(),
	}
}

func (l *rgaList[T]) Integrate(id, ref opID, v T) error {
	if _, ok := l.applied.Get(id); ok {
		return fmt.Errorf("duplicate op ID in the list")
	}

	var left string
	if ref != zeroOpID {
		refFracdex, ok := l.applied.Get(ref)
		if !ok {
			return fmt.Errorf("%w: ref op %v is not found", errCausalityViolation, ref)
		}
		left = refFracdex
	}

	var right string
	for k, v := range l.items.Seek(left) {
		// Seek returns the pivot item first.
		if k == left {
			continue
		}

		// RGA rules: skip over any elements with a greater ID to the right of our desired insertion point.
		if v.ID.Compare(id) > 0 {
			left = k
			continue
		} else {
			right = k
			break
		}
	}

	newPos, err := fracdex.KeyBetween(left, right)
	if err != nil {
		return err
	}

	newItem := rgaItem[T]{ID: id, Ref: ref, Value: v}

	if l.items.Set(newPos, newItem) {
		panic("BUG: duplicate fracdex")
	}

	if l.applied.Set(id, newPos) {
		panic("BUG: duplicate op ID")
	}

	return nil
}

func (l *rgaList[T]) ValuesAlive() iter.Seq[T] {
	return func(yield func(T) bool) {
		for _, v := range l.items.Items() {
			if v.IsDeleted {
				continue
			}

			if !yield(v.Value) {
				break
			}
		}
	}
}

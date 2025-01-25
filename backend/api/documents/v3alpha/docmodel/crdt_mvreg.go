package docmodel

import (
	"seed/backend/util/btree"
	"slices"
)

type mvRegValue[V any] struct {
	Value V
	Preds []opID
}

// mvReg is a multi-value register CRDT.
type mvReg[V any] struct {
	state *btree.Map[opID, mvRegValue[V]]
}

func newMVReg[V any]() *mvReg[V] {
	return &mvReg[V]{
		state: btree.New[opID, mvRegValue[V]](8, opID.Compare),
	}
}

func (s *mvReg[V]) GetLatestOK() (v V, ok bool) {
	_, vv, ok := s.state.GetAt(s.state.Len() - 1)
	return vv.Value, ok
}

func (s *mvReg[V]) GetLatest() V {
	v, _ := s.GetLatestOK()
	return v
}

func (s *mvReg[V]) GetLatestWithID() (id opID, v V, ok bool) {
	id, vv, ok := s.state.GetAt(s.state.Len() - 1)
	return id, vv.Value, ok
}

func (s *mvReg[V]) Set(oid opID, v V) {
	preds := slices.Collect(s.state.Keys())
	s.state.Clear()
	if s.state.Set(oid, mvRegValue[V]{Value: v, Preds: preds}) {
		panic("BUG: multiple values with the same op id")
	}
}

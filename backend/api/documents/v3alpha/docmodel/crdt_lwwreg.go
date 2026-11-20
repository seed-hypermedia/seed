package docmodel

// lwwReg is a last-writer-wins register: it holds the single value written by
// the highest op ID it has seen.
//
// The winner depends only on the set of writes, never on the order they are
// applied in. That matters because changes can be applied in different orders
// (a full replay sorts them, while a late-arriving concurrent change lands on
// top of an existing state), and every order must converge to the same value.
type lwwReg[V any] struct {
	id    opID
	value V
	ok    bool
}

func newLWWReg[V any]() *lwwReg[V] {
	return &lwwReg[V]{}
}

// GetLatestOK returns the winning value, and false if nothing was written yet.
func (s *lwwReg[V]) GetLatestOK() (v V, ok bool) {
	return s.value, s.ok
}

// GetLatest returns the winning value, or the zero value if nothing was written yet.
func (s *lwwReg[V]) GetLatest() V {
	return s.value
}

// GetLatestWithID returns the winning value with the op ID that wrote it.
func (s *lwwReg[V]) GetLatestWithID() (id opID, v V, ok bool) {
	return s.id, s.value, s.ok
}

// Set records a write and reports whether it won. It wins only if its op ID is
// greater than the current winner's; an older or equal write is ignored.
func (s *lwwReg[V]) Set(oid opID, v V) bool {
	if s.ok && s.id.Compare(oid) >= 0 {
		return false
	}

	s.id = oid
	s.value = v
	s.ok = true
	return true
}

// replace overwrites the winning value in place, keeping its op ID. It is used
// to turn a superseded value into a tombstone without changing its position in
// the op order.
func (s *lwwReg[V]) replace(oid opID, v V) {
	s.id = oid
	s.value = v
	s.ok = true
}

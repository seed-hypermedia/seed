package colx

// HashSet is a map-backed set.
// Zero value is useful.
type HashSet[T comparable] map[T]struct{}

// Has checks if v is in the set.
func (hs HashSet[T]) Has(v T) bool {
	if hs == nil {
		return false
	}
	_, ok := hs[v]
	return ok
}

// Put adds v to the set.
func (hs *HashSet[T]) Put(v T) {
	if *hs == nil {
		*hs = make(HashSet[T])
	}
	(*hs)[v] = struct{}{}
}

// PutMany adds multiple values to the set.
func (hs *HashSet[T]) PutMany(v []T) {
	if *hs == nil {
		*hs = make(HashSet[T])
	}
	for _, x := range v {
		(*hs)[x] = struct{}{}
	}
}

// Delete removes v from the set.
func (hs HashSet[T]) Delete(v T) {
	if hs == nil {
		return
	}
	delete(hs, v)
}

// Map returns the underlying map.
func (hs HashSet[T]) Map() map[T]struct{} {
	return map[T]struct{}(hs)
}

// Slice returns values from the set as a slice.
func (hs HashSet[T]) Slice() []T {
	if hs == nil {
		return nil
	}
	s := make([]T, 0, len(hs))
	for v := range hs {
		s = append(s, v)
	}
	return s
}

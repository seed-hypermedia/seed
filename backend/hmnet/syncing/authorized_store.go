package syncing

import (
	"seed/backend/core"
	"seed/backend/hmnet/syncing/rbsr"
)

// authorizedStore wraps an RBSR store with per-item visibility data.
// It supports deferred authorization filtering via WithFilter.
type authorizedStore struct {
	rbsr.Store
	// privateOnly maps an item's value (its CID key) to the spaces it is
	// visible to; items absent from it are public. It is keyed by value rather
	// than by position because both backing stores reorder items (the slice
	// store sorts at Seal, the tree store on insert), so a loader's row counter
	// says nothing about where an item ends up.
	privateOnly map[string][]core.Principal
	authSet     map[core.PrincipalUnsafeString]struct{}
}

// newAuthorizedStore creates a new store wrapper backed by a slice store.
func newAuthorizedStore() *authorizedStore {
	return &authorizedStore{
		Store:       rbsr.NewSliceStore(),
		privateOnly: make(map[string][]core.Principal),
	}
}

// newAuthorizedTreeStore creates a store wrapper backed by a monoid tree, whose
// O(log n) RangeFingerprint the maintained index serves from.
func newAuthorizedTreeStore() *authorizedStore {
	return &authorizedStore{
		Store:       rbsr.NewTreeStore(),
		privateOnly: make(map[string][]core.Principal),
	}
}

// SetItemPrivateVisibility records that the item with the given value (the CID
// key passed to Insert) is private to space. Must be called before the store
// is shared through WithFilter.
func (s *authorizedStore) SetItemPrivateVisibility(id string, space core.Principal) {
	if len(space) == 0 {
		panic("BUG: SetItemPrivateVisibility called with no spaces")
	}

	s.privateOnly[id] = append(s.privateOnly[id], space)
}

// RangeFingerprint implements [rbsr.RangeFingerprinter] in a visibility-safe
// way. The inner store's fast path fingerprints the whole [start,end) ignoring
// visibility; that equals the filtered fingerprint only when no item is private
// (then nothing is ever filtered out), which is the ~99% public case. When any
// private item exists we fold over the visibility-filtered ForEach instead, so
// an unauthorized peer never sees a fingerprint that accounts for blobs it
// can't read.
func (s *authorizedStore) RangeFingerprint(start, end int) (rbsr.Fingerprint, error) {
	if rf, ok := s.Store.(rbsr.RangeFingerprinter); ok && len(s.privateOnly) == 0 {
		return rf.RangeFingerprint(start, end)
	}
	return rbsr.FoldFingerprint(s, start, end)
}

// ForEach iterates over items, applying the filter if set.
func (s *authorizedStore) ForEach(start, end int, fn func(int, rbsr.Item) bool) error {
	return s.Store.ForEach(start, end, func(i int, item rbsr.Item) bool {
		if !s.filter(item) {
			return true // skip, continue
		}
		return fn(i, item)
	})
}

// WithFilter returns a shallow clone with the filter set for the given authorized spaces.
// The clone shares the inner store and visibility data.
//
// The receiver must be fully built and sealed before this is called: one sealed
// store is shared across all the peer goroutines of a sync fan-out, and each of
// them clones it here. The visibility map is shared as is; nothing writes to it
// once the loader returns, so concurrent reads are safe.
func (s *authorizedStore) WithFilter(authorizedSpaces []core.Principal) *authorizedStore {
	var authSet map[core.PrincipalUnsafeString]struct{}
	if len(authorizedSpaces) > 0 {
		authSet = make(map[core.PrincipalUnsafeString]struct{}, len(authorizedSpaces))
		for _, sp := range authorizedSpaces {
			authSet[sp.UnsafeString()] = struct{}{}
		}
	}

	return &authorizedStore{
		Store:       s.Store,
		privateOnly: s.privateOnly,
		authSet:     authSet,
	}
}

// filter reports whether item passes the visibility filter: public items
// always do, private ones only when one of their spaces is authorized.
func (s *authorizedStore) filter(item rbsr.Item) bool {
	spaces, isPrivate := s.privateOnly[string(item.Value)]
	if !isPrivate {
		return true
	}

	for _, sp := range spaces {
		if _, ok := s.authSet[sp.UnsafeString()]; ok {
			return true
		}
	}

	return false
}

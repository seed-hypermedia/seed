package syncing

import (
	"bytes"
	"cmp"
	"seed/backend/core"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/util/btree"
)

type visibilityKey struct {
	ItemIndex int
	Space     core.Principal
}

func (vk visibilityKey) Compare(other visibilityKey) int {
	x := cmp.Compare(vk.ItemIndex, other.ItemIndex)
	if x != 0 {
		return x
	}

	return bytes.Compare(vk.Space, other.Space)
}

// authorizedStore wraps an RBSR store with per-item visibility data.
// It supports deferred authorization filtering via WithFilter.
type authorizedStore struct {
	rbsr.Store
	privateOnly *btree.Map[visibilityKey, struct{}]
	authSet     map[core.PrincipalUnsafeString]struct{}
}

// newAuthorizedStore creates a new store wrapper.
func newAuthorizedStore() *authorizedStore {
	return &authorizedStore{
		Store:       rbsr.NewSliceStore(),
		privateOnly: btree.New[visibilityKey, struct{}](32, visibilityKey.Compare),
	}
}

func (s *authorizedStore) SetItemPrivateVisibility(i int, space core.Principal) {
	if len(space) == 0 {
		panic("BUG: SetItemPrivateVisibility called with no spaces")
	}

	vk := visibilityKey{ItemIndex: i, Space: space}
	s.privateOnly.Set(vk, struct{}{})
}

// ForEach iterates over items, applying the filter if set.
func (s *authorizedStore) ForEach(start, end int, fn func(int, rbsr.Item) bool) error {
	return s.Store.ForEach(start, end, func(i int, item rbsr.Item) bool {
		if !s.filter(i) {
			return true // skip, continue
		}
		return fn(i, item)
	})
}

// WithFilter returns a shallow clone with the filter set for the given authorized spaces.
// The clone shares the inner store and visibility data.
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
		privateOnly: s.privateOnly.Copy(),
		authSet:     authSet,
	}
}

func (s *authorizedStore) filter(i int) (ok bool) {
	// Check if this item has any private visibility records.
	// Items with no visibility records are public and always pass.
	var isPrivate bool
	for k := range s.privateOnly.Seek(visibilityKey{ItemIndex: i}) {
		if k.ItemIndex != i {
			// Moved past this item's entries.
			break
		}

		isPrivate = true

		if len(s.authSet) == 0 {
			continue
		}
		if _, ok := s.authSet[k.Space.UnsafeString()]; ok {
			// At least one space from the authorized list matches,
			// so the filter passes.
			return true
		}
	}

	// If item has no private visibility, it's public and passes.
	// If it has private visibility but none matched authSet, it fails.
	return !isPrivate
}

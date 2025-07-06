// Package lwwmap provides a simple CRDT map implementation with Last-Writer-Wins semantics.
package lwwmap

import (
	"bytes"
	"iter"
	"seed/backend/util/btree"
	"seed/backend/util/colx"
	"slices"

	"rsc.io/ordered"
)

// Path represents a path in the nested map/object.
type Path = []string

// Map is a CRDT map with Last-Writer-Wins semantics.
// It's backed by a B-Tree that stores the values as key-value pairs.
// Nested objects are flattened into a single key with multiple parts.
type Map struct {
	maxTs int64
	m     *btree.Map[Path, Value]
}

// New creates a new CRDT map.
func New() *Map {
	return &Map{
		m: btree.New[Path, Value](8, func(a, b Path) int {
			return slices.Compare(a, b)
		}),
	}
}

// ApplyPatch merges values from a flattened map iterator into the CRDT map,
// using the provided timestamp for each value.
func (m *Map) ApplyPatch(ts int64, seq iter.Seq2[Path, any]) {
	for path, value := range seq {
		m.Set(ts, path, value)
	}
}

// Get the value at the given path in the CRDT map.
func (m *Map) Get(path Path) (value any, ok bool) {
	if node, ok := m.m.GetNode(path); ok {
		return node.V.V, true
	}
	return nil, false
}

// Set the value at the given path in the CRDT map.
func (m *Map) Set(ts int64, unsafePath Path, value any) {
	newValue := Value{
		Ts: ts,
		V:  value,
	}

	// If there was an existing entry on the same path we can safely
	// merge it using the LWW rules, and return.
	// It means the previous entry was a primitive value, not a nested map.
	// For other situation we need to perform more checks to preserve the nested structure invariants.
	if node, ok := m.m.GetNode(unsafePath); ok {
		if newValue.Compare(node.V) > 0 {
			// Reusing the path from the old node to avoid cloning the unsafe path unnecessarily.
			m.m.Set(node.K, newValue)
		}
		return
	}

	// Checking parents. We can only insert the current value if all parents are older,
	// or they are already a nested map (which means they don't have an entry in the map).
	// Older entries would need to be removed later, when we know for sure we can insert our new value.
	obsoleteEntries := make([]Path, 0, 32) // Arbitrary default size preallocated.
	for prefix := range prefixes(unsafePath) {
		old, ok := m.m.GetNode(prefix)
		if !ok {
			continue
		}

		// Parent values with lower timestamps need to be removed later.
		if old.V.Compare(newValue) < 0 {
			obsoleteEntries = append(obsoleteEntries, old.K)
		} else {
			// Parent values that are newer prevent us from insert the current value,
			// because we assume the path to the root is all nested maps, but we found a primite value instead that is newer.
			return
		}
	}

	// Now we do the same check for subtrees. We can only insert our value if none of the deeper paths exist with a newer timestamp.
	for k, v := range m.m.Range(unsafePath, append(unsafePath, "\xFF\xFF")) {
		if v.Compare(newValue) < 0 {
			obsoleteEntries = append(obsoleteEntries, k)
		} else {
			// Subtree values that are newer prevent us from insert the current value,
			// because we assume the path to the root is all nested maps, but we found a primite value instead that is newer.
			return
		}
	}

	// If we reach this point it means we can insert the current value.
	// But we need to clean up obsolete entries.
	m.m.Set(clone(unsafePath), newValue)
	m.maxTs = max(m.maxTs, newValue.Ts)
	for _, k := range obsoleteEntries {
		m.m.Delete(k)
	}
}

// MaxTS returns the maximum timestamp of all values in the map.
func (m *Map) MaxTS() int64 {
	return m.maxTs
}

// Map hydrates the CRDT map into a nested native map.
func (m *Map) Map() map[string]any {
	out := make(map[string]any)

	for path, value := range m.m.Items() {
		colx.ObjectSet(out, path, value.V)
	}

	return out
}

// Value is a timestamped value of a map.
type Value struct {
	Ts int64
	V  any
}

// Compare two values to know whether the other value is newer than this one.
// The result is negative if this value is older than the other value,
// zero if they are equal,
// and positive if this value is newer than the other value.
func (v Value) Compare(other Value) int {
	if v.Ts < other.Ts {
		return -1
	}

	if v.Ts > other.Ts {
		return +1
	}

	// When timestamps are equal we break the tie by comparing the values "lexicographically".
	// Because not all values are comparable, we use an order-preserving encoding
	// with clearly defined semantics for comparing values of different types as bytes.
	return bytes.Compare(
		ordered.Encode(v.V),
		ordered.Encode(other.V),
	)
}

// clone creates a shallow copy of a slice of strings.
// Not using [slices.Clone] here, because it may leave extra capacity in the resulting slice which we don't need.
func clone(in Path) Path {
	out := make(Path, len(in))
	copy(out, in)
	return out
}

func prefixes(path Path) iter.Seq[Path] {
	return func(yield func(Path) bool) {
		for i := 1; i < len(path); i++ {
			if !yield(path[:i]) {
				return
			}
		}
	}
}

// Package attrkey provides helpers for document attribute names.
package attrkey

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// SearchKey returns the NFC-normalized, Unicode case-folded form of an
// attribute name. It preserves distinctions that compatibility normalization
// would erase.
func SearchKey(name string) string {
	return norm.NFC.String(cases.Fold().String(norm.NFC.String(name)))
}

// SearchPath returns the Unicode case-folded form of each path segment.
func SearchPath(path []string) []string {
	out := make([]string, len(path))
	for i, segment := range path {
		out[i] = SearchKey(segment)
	}
	return out
}

// Set stores a value under an exact, case-sensitive path.
func Set(object map[string]any, path []string, value any) {
	for i, segment := range path {
		if i == len(path)-1 {
			object[segment] = value
			return
		}

		child, ok := object[segment].(map[string]any)
		if !ok {
			child = map[string]any{}
			object[segment] = child
		}
		object = child
	}
}

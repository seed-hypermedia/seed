package lwwmap

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMap_Map(t *testing.T) {
	t.Run("should return an empty map for an empty CRDT map", func(t *testing.T) {
		m := New()
		result := m.Map()
		require.Equal(t, map[string]any{}, result)
	})

	t.Run("should correctly hydrate a flat map", func(t *testing.T) {
		m := New()
		m.Set(1, []string{"a"}, "value-a")
		m.Set(2, []string{"b"}, 42)
		m.Set(3, []string{"c"}, true)

		expected := map[string]any{
			"a": "value-a",
			"b": 42,
			"c": true,
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should correctly hydrate a nested map", func(t *testing.T) {
		m := New()
		m.Set(1, []string{"a", "b"}, "nested-value")
		m.Set(2, []string{"a", "c"}, 42)
		m.Set(3, []string{"d"}, true)

		expected := map[string]any{
			"a": map[string]any{
				"b": "nested-value",
				"c": 42,
			},
			"d": true,
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should ignore subtrees when parent path is later set to a primitive value", func(t *testing.T) {
		m := New()

		// First set nested values
		m.Set(1, []string{"parent", "child1"}, "child-value-1")
		m.Set(2, []string{"parent", "child2"}, "child-value-2")

		// Then overwrite the parent with a primitive value with a higher timestamp
		m.Set(3, []string{"parent"}, "parent-value")

		// The subtree should be ignored, and only the primitive parent value should be present
		expected := map[string]any{
			"parent": "parent-value",
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should not ignore subtrees when parent path is set to a primitive value with earlier timestamp", func(t *testing.T) {
		m := New()

		m.Set(2, []string{"parent", "child1"}, "child-value-1")
		m.Set(3, []string{"parent", "child2"}, "child-value-2")

		// Set parent value to a primitive value, but using an older timestamp.
		m.Set(1, []string{"parent"}, "parent-value")

		// The parent value should be overwritten by the nested structure
		expected := map[string]any{
			"parent": map[string]any{
				"child1": "child-value-1",
				"child2": "child-value-2",
			},
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should handle deeply nested structures", func(t *testing.T) {
		m := New()
		m.Set(1, []string{"a", "b", "c", "d"}, "deep-value")
		m.Set(2, []string{"a", "b", "e"}, "less-deep-value")
		m.Set(3, []string{"a", "f"}, "shallow-value")

		expected := map[string]any{
			"a": map[string]any{
				"b": map[string]any{
					"c": map[string]any{
						"d": "deep-value",
					},
					"e": "less-deep-value",
				},
				"f": "shallow-value",
			},
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should handle multiple overwrites with different timestamps", func(t *testing.T) {
		m := New()
		m.Set(1, []string{"key"}, "value-1")
		m.Set(3, []string{"key"}, "value-3")
		m.Set(2, []string{"key"}, "value-2") // Out of order but lower timestamp than value-3

		expected := map[string]any{
			"key": "value-3", // Should be the value with the highest timestamp
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should handle values with same timestamps but different values", func(t *testing.T) {
		m := New()
		m.Set(1, []string{"key"}, "value-a")
		m.Set(1, []string{"key"}, "value-z") // Same timestamp, but "z" is lexicographically greater than "a"

		expected := map[string]any{
			"key": "value-z", // Should be the lexicographically greater value
		}

		require.Equal(t, expected, m.Map())
	})

	t.Run("should correctly handle complex scenario with mixed overrides", func(t *testing.T) {
		m := New()

		// Set nested values
		m.Set(1, []string{"user", "profile", "name"}, "John")
		m.Set(2, []string{"user", "profile", "age"}, 30)

		// Override the middle path with a primitive
		m.Set(3, []string{"user", "profile"}, "simple-profile")

		// Add another nested path with higher timestamp
		m.Set(4, []string{"user", "settings", "theme"}, "dark")

		// Try to add a nested value under the previously overridden path
		m.Set(2, []string{"user", "profile", "gender"}, "male") // Lower timestamp than the override

		expected := map[string]any{
			"user": map[string]any{
				"profile": "simple-profile",
				"settings": map[string]any{
					"theme": "dark",
				},
			},
		}

		require.Equal(t, expected, m.Map())
	})
}

func TestPrefixes(t *testing.T) {
	p := []string{"a", "b", "c", "d"}
	prefixes := slices.Collect(prefixes(p))
	want := [][]string{
		{"a"},
		{"a", "b"},
		{"a", "b", "c"},
	}
	require.Equal(t, want, prefixes)
}

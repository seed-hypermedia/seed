package colx

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestObjectSet(t *testing.T) {
	m := map[string]any{}

	ObjectSet(m, []string{"foo", "bar", "baz"}, "Hello")

	require.Equal(t, map[string]any{
		"foo": map[string]any{
			"bar": map[string]any{
				"baz": "Hello",
			},
		},
	}, m)
}

func TestObjectSetTypeChange(t *testing.T) {
	m := map[string]any{}

	ObjectSet(m, []string{"a", "b", "c", "d"}, "Hello")
	require.Equal(t, map[string]any{
		"a": map[string]any{
			"b": map[string]any{
				"c": map[string]any{
					"d": "Hello",
				},
			},
		},
	}, m)

	ObjectSet(m, []string{"a", "b"}, "Foo")
	require.Equal(t, map[string]any{
		"a": map[string]any{
			"b": "Foo",
		},
	}, m)

	ObjectSet(m, []string{"a", "b", "c", "d"}, "Hello2")
	require.Equal(t, map[string]any{
		"a": map[string]any{
			"b": map[string]any{
				"c": map[string]any{
					"d": "Hello2",
				},
			},
		},
	}, m)
}

func TestObjectDelete(t *testing.T) {
	m := map[string]any{}

	ObjectSet(m, []string{"foo", "bar", "baz"}, "Hello")
	ObjectSet(m, []string{"name"}, "Alice")
	ObjectDelete(m, []string{"foo", "bar"})

	require.Equal(t, map[string]any{
		"name": "Alice",
		"foo":  map[string]any{},
	}, m)
}

func TestObjectDeleteMissing(t *testing.T) {
	m := map[string]any{}
	ObjectDelete(m, []string{"foo", "bar"})
	require.Len(t, m, 0, "delete must not created nested maps")
}

func TestObjectWalk(t *testing.T) {
	m := map[string]any{
		"a": map[string]any{
			"hello": "world",
			"b": map[string]any{
				"c":   1,
				"foo": "bar",
			},
		},
	}

	type item struct {
		Path  []string
		Value any
	}

	want := []item{
		{[]string{"a", "hello"}, "world"},
		{[]string{"a", "b", "c"}, 1},
		{[]string{"a", "b", "foo"}, "bar"},
	}

	var got []item
	for path, v := range ObjectWalk(m) {
		got = append(got, item{path.Clone(), v})
	}

	slices.SortFunc(want, func(a, b item) int { return slices.Compare(a.Path, b.Path) })
	slices.SortFunc(got, func(a, b item) int { return slices.Compare(a.Path, b.Path) })

	require.Equal(t, want, got, "all values must match")

	// Testing that breaking from the loop doesn't panic.
	for range ObjectWalk(m) {
		break
	}
}

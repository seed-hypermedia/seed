package colx

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHashSet_ZeroValue(t *testing.T) {
	var hs HashSet[string]

	require.False(t, hs.Has("test"))
	require.Nil(t, hs.Slice())
	require.Nil(t, hs.Map())

	hs.Delete("nonexistent")
}

func TestHashSet_Put(t *testing.T) {
	var hs HashSet[string]

	hs.Put("hello")
	require.True(t, hs.Has("hello"))
	require.False(t, hs.Has("world"))

	hs.Put("world")
	require.True(t, hs.Has("hello"))
	require.True(t, hs.Has("world"))

	hs.Put("hello")
	require.True(t, hs.Has("hello"))
	require.Len(t, hs.Slice(), 2)
}

func TestHashSet_PutMany(t *testing.T) {
	var hs HashSet[int]

	hs.PutMany([]int{1, 2, 3, 2, 4})
	require.True(t, hs.Has(1))
	require.True(t, hs.Has(2))
	require.True(t, hs.Has(3))
	require.True(t, hs.Has(4))
	require.False(t, hs.Has(5))
	require.Len(t, hs.Slice(), 4)

	hs.PutMany([]int{5, 6})
	require.True(t, hs.Has(5))
	require.True(t, hs.Has(6))
	require.Len(t, hs.Slice(), 6)
}

func TestHashSet_Delete(t *testing.T) {
	var hs HashSet[string]

	hs.Delete("nonexistent")

	hs.Put("hello")
	hs.Put("world")
	require.True(t, hs.Has("hello"))
	require.True(t, hs.Has("world"))

	hs.Delete("hello")
	require.False(t, hs.Has("hello"))
	require.True(t, hs.Has("world"))

	hs.Delete("world")
	require.False(t, hs.Has("hello"))
	require.False(t, hs.Has("world"))
	require.Len(t, hs.Slice(), 0)
}

func TestHashSet_Slice(t *testing.T) {
	var hs HashSet[int]

	require.Nil(t, hs.Slice())

	hs.Put(1)
	hs.Put(2)
	hs.Put(3)

	slice := hs.Slice()
	require.Len(t, slice, 3)

	seen := make(map[int]bool)
	for _, v := range slice {
		seen[v] = true
	}
	require.True(t, seen[1])
	require.True(t, seen[2])
	require.True(t, seen[3])
}

func TestHashSet_Map(t *testing.T) {
	var hs HashSet[string]

	require.Nil(t, hs.Map())

	hs.Put("hello")
	hs.Put("world")

	m := hs.Map()
	require.Len(t, m, 2)

	_, ok := m["hello"]
	require.True(t, ok)
	_, ok = m["world"]
	require.True(t, ok)
	_, ok = m["nonexistent"]
	require.False(t, ok)
}

func TestHashSet_Operations(t *testing.T) {
	var hs HashSet[int]

	numbers := []int{10, 20, 30, 40, 50}
	hs.PutMany(numbers)

	for _, num := range numbers {
		require.True(t, hs.Has(num))
	}

	hs.Delete(30)
	require.False(t, hs.Has(30))
	require.Len(t, hs.Slice(), 4)

	hs.Put(60)
	require.True(t, hs.Has(60))
	require.Len(t, hs.Slice(), 5)
}

func TestHashSet_WithDifferentTypes(t *testing.T) {
	t.Run("string", func(t *testing.T) {
		var hs HashSet[string]
		hs.Put("test")
		require.True(t, hs.Has("test"))
	})

	t.Run("int", func(t *testing.T) {
		var hs HashSet[int]
		hs.Put(42)
		require.True(t, hs.Has(42))
	})

	t.Run("bool", func(t *testing.T) {
		var hs HashSet[bool]
		hs.Put(true)
		hs.Put(false)
		require.True(t, hs.Has(true))
		require.True(t, hs.Has(false))
		require.Len(t, hs.Slice(), 2)
	})
}

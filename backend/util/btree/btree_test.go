package btree

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCopyOnWrite(t *testing.T) {
	bt := New[string, string](8, strings.Compare)

	bt.Set("a", "Hello")
	bt.Set("b", "World")

	bt.Copy().Set("a", "Changed")

	fmt.Println(bt.GetMaybe("a"))
}

func TestSeek(t *testing.T) {
	bt := New[string, string](8, strings.Compare)

	bt.Set("aa", "A")
	bt.Set("aa1", "A1")
	bt.Set("aab", "B")
	bt.Set("aabc", "C")
	bt.Set("Z", "Z")

	for k, _ := range bt.Seek("a") {
		if k == "a" {
			t.Fatal("seek must not return the pivot key if it doesn't exist in the map")
		}
	}
}

func TestRange(t *testing.T) {
	bt := New[string, string](8, strings.Compare)

	bt.Set("aa", "A")
	bt.Set("aa1", "A1")
	bt.Set("aab", "B")
	bt.Set("aabc", "C")
	bt.Set("a1", "A")
	bt.Set("ab", "A")
	bt.Set("Z", "Z")

	want := []string{"aa", "aa1", "aab", "aabc", "a1", "ab"}
	slices.Sort(want)

	var i int
	for k, _ := range bt.Range("a", "a\xFF\xFF") {
		require.Equal(t, want[i], k, "%d: range must return all keys in the range", i)
		i++
	}
	require.Equal(t, len(want), i, "range must return all keys in the range")
}

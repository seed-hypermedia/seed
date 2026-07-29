package btree

import (
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
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

func TestReadOnlyView(t *testing.T) {
	bt := New[string, string](8, strings.Compare)
	bt.Set("a", "A")
	bt.Set("b", "B")

	view := bt.ReadOnlyView()
	require.Equal(t, bt.Len(), view.Len(), "view must expose the same elements")
	require.Equal(t, "A", view.GetMaybe("a"))
	require.Equal(t, "B", view.GetMaybe("b"))
}

// TestReadOnlyViewConcurrent is the regression test for the data race that
// concurrent Copy calls used to cause: Copy stamps a fresh isolation ID onto its
// source, and our trees carry NoLocks, so N goroutines cloning one shared map
// wrote the same field at once. ReadOnlyView never touches the source, so this
// passes under -race. Swapping ReadOnlyView for Copy below makes it fail.
func TestReadOnlyViewConcurrent(t *testing.T) {
	bt := New[string, string](8, strings.Compare)

	want := make([]string, 0, 512)
	for i := range 512 {
		k := fmt.Sprintf("key-%04d", i)
		bt.Set(k, k)
		want = append(want, k)
	}

	// The source is frozen from here on, which is what makes views legal.
	const goroutines = 32
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // Maximize the overlap between the cloning calls.

			view := bt.ReadOnlyView()

			got := make([]string, 0, len(want))
			for k, v := range view.Items() {
				assert.Equal(t, k, v)
				got = append(got, k)
			}
			assert.Equal(t, want, got, "each view must see the whole source map")
		}()
	}
	close(start)
	wg.Wait()
}

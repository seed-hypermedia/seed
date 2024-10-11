package docmodel

import (
	"errors"
	"slices"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCRDTList(t *testing.T) {
	in := []rgaItem[string]{
		{newOpID(1, "alice", 0), opID{}, "A"},
		{newOpID(1, "alice", 1), newOpID(1, "alice", 0), "B"},
		{newOpID(1, "alice", 2), newOpID(1, "alice", 1), "C"},

		{newOpID(1, "bob", 0), opID{}, "X"},
		{newOpID(1, "bob", 1), newOpID(1, "bob", 0), "Y"},
		{newOpID(1, "bob", 2), newOpID(1, "bob", 1), "Z"},
	}

	want := []string{"X", "Y", "Z", "A", "B", "C"}

	for i, perm := range permute(in) {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			l := newRGAList[string]()
			for _, item := range perm {
				if err := l.Integrate(item.ID, item.Ref, item.Value); err != nil {
					if errors.Is(err, errCausalityViolation) {
						// Permutations are expected to violate causality, so we ignore those errors.
						return
					}
					t.Fatalf("Integrate failed: %v", err)
				}
			}
			got := slices.Collect(l.ValuesAlive())
			require.Equal(t, want, got)
		})
	}
}

func permute[T any](arr []T) [][]T {
	n := len(arr)
	var res [][]T

	// c is the control array that keeps track of the swaps
	c := make([]int, n)

	// Add the initial permutation
	perm := make([]T, n)
	copy(perm, arr)
	res = append(res, perm)

	i := 0
	for i < n {
		if c[i] < i {
			// Swap according to whether i is even or odd
			if i%2 == 0 {
				arr[0], arr[i] = arr[i], arr[0]
			} else {
				arr[c[i]], arr[i] = arr[i], arr[c[i]]
			}

			// Add the current permutation to the result
			perm := make([]T, n)
			copy(perm, arr)
			res = append(res, perm)

			// Increment the control array
			c[i] += 1
			// Reset i
			i = 0
		} else {
			// Reset c[i] and move to the next position
			c[i] = 0
			i++
		}
	}

	return res
}

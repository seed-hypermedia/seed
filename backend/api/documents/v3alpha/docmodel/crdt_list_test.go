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
		{ID: newOpID(1, 1, 0), Ref: opID{}, Value: "A"},
		{ID: newOpID(1, 1, 1), Ref: newOpID(1, 1, 0), Value: "B"},
		{ID: newOpID(1, 1, 2), Ref: newOpID(1, 1, 1), Value: "C"},

		{ID: newOpID(1, 2, 0), Ref: opID{}, Value: "X"},
		{ID: newOpID(1, 2, 1), Ref: newOpID(1, 2, 0), Value: "Y"},
		{ID: newOpID(1, 2, 2), Ref: newOpID(1, 2, 1), Value: "Z"},
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

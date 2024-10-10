package lookup

import (
	"cmp"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPointer(t *testing.T) {
	var ltb Builder[string]

	// Input values to be added to the lookup table.
	// They are not used in order, so we'll get the pointers into the table,
	// which will be replaced after the final table is built and sorted.
	in := []string{"hey", "hey", "ho", "alice", "z"}
	ptrs := make([]*Pointer, len(in))
	for i, v := range in {
		ptrs[i] = ltb.Add(v)
	}

	lookup := ltb.Build(cmp.Compare)

	for i, v := range in {
		ptr := ptrs[i]
		require.Equal(t, v, lookup.Get(ptr))
	}
}

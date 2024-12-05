package blob

import (
	"testing"

	"github.com/ipfs/boxo/blockstore"
)

var _ blockstore.Blockstore = (*Index)(nil)

func TestBreadcrumbs(t *testing.T) {
	tests := []struct {
		input    IRI
		expected []IRI
	}{
		{
			input:    "hm://test",
			expected: []IRI{"hm://test"},
		},
		{
			input:    "hm://test/foo",
			expected: []IRI{"hm://test", "hm://test/foo"},
		},
		{
			input:    "hm://test/foo/bar",
			expected: []IRI{"hm://test", "hm://test/foo", "hm://test/foo/bar"},
		},
		{
			input:    "hm://test/foo/bar/baz",
			expected: []IRI{"hm://test", "hm://test/foo", "hm://test/foo/bar", "hm://test/foo/bar/baz"},
		},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			got := tt.input.Breadcrumbs()
			if len(got) != len(tt.expected) {
				t.Errorf("Breadcrumbs() got %d results, expected %d", len(got), len(tt.expected))
				return
			}
			for i := range got {
				if got[i] != tt.expected[i] {
					t.Errorf("Breadcrumbs()[%d] = %v, expected %v", i, got[i], tt.expected[i])
				}
			}
		})
	}
}
